/**
 * Despliegue de "Nombres Clave" en AWS con Pulumi.
 *
 * Todo lo que se crea cabe en la capa gratuita: una EC2 t2.micro (750 h/mes),
 * 8 GB de EBS gp3 (de 30 GB gratis), una IP elástica (gratis mientras esté
 * asociada a una instancia encendida) y un bucket S3 con un tarball de ~60 KB.
 *
 * El DNS vive en Cloudflare: se crea el registro A a mano (o con
 * ./cloudflare-dns.sh) apuntando a la IP que imprime este stack.
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { execSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

const cfg = new pulumi.Config();
const domain = cfg.get("domain") ?? "codenames.cnexans.com";
const acmeEmail = cfg.get("acmeEmail") ?? `admin@${domain.split(".").slice(-2).join(".")}`;
const instanceType = cfg.get("instanceType") ?? "t2.micro"; // capa gratuita en us-east-1
const sshCidr = cfg.get("sshCidr"); // opcional; por defecto se entra por SSM
const openTestPort = cfg.getBoolean("openTestPort") ?? true; // http://IP:3000 antes del DNS

// ── 1. Empaquetar la app (sin node_modules) ─────────────────────────────
const root = path.join(__dirname, "..");
const buildDir = path.join(__dirname, ".build");
const tarball = path.join(buildDir, "app.tgz");
fs.mkdirSync(buildDir, { recursive: true });

const files = "package.json package-lock.json server public";
const tarCmd = (extra: string) =>
  `COPYFILE_DISABLE=1 tar ${extra} -cf - -C '${root}' ${files} | gzip -n > '${tarball}'`;
try {
  execSync(tarCmd("--no-mac-metadata"), { shell: "/bin/bash", stdio: "pipe" }); // bsdtar (macOS)
} catch {
  execSync(tarCmd(""), { shell: "/bin/bash", stdio: "pipe" }); // GNU tar
}
// Hash del contenido: si la app cambia, la instancia se reemplaza con la versión nueva.
const appHash = crypto.createHash("sha256").update(fs.readFileSync(tarball)).digest("hex").slice(0, 16);

const bucket = new aws.s3.BucketV2("codenames-artifacts", { forceDestroy: true });
new aws.s3.BucketPublicAccessBlock("codenames-artifacts-private", {
  bucket: bucket.id,
  blockPublicAcls: true,
  blockPublicPolicy: true,
  ignorePublicAcls: true,
  restrictPublicBuckets: true,
});
const appObject = new aws.s3.BucketObjectv2("codenames-app", {
  bucket: bucket.id,
  key: `app-${appHash}.tgz`,
  source: new pulumi.asset.FileAsset(tarball),
});

// ── 2. Permisos de la instancia (leer el bucket + entrar por SSM) ───────
const role = new aws.iam.Role("codenames-role", {
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({ Service: "ec2.amazonaws.com" }),
});
new aws.iam.RolePolicyAttachment("codenames-ssm", {
  role: role.name,
  policyArn: "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore",
});
new aws.iam.RolePolicy("codenames-s3-read", {
  role: role.id,
  policy: pulumi.jsonStringify({
    Version: "2012-10-17",
    Statement: [{ Effect: "Allow", Action: ["s3:GetObject"], Resource: pulumi.interpolate`${bucket.arn}/*` }],
  }),
});
const instanceProfile = new aws.iam.InstanceProfile("codenames-profile", { role: role.name });

// ── 3. Red ──────────────────────────────────────────────────────────────
const vpc = aws.ec2.getVpcOutput({ default: true });
const subnets = aws.ec2.getSubnetsOutput({
  filters: [
    { name: "vpc-id", values: [vpc.id] },
    { name: "default-for-az", values: ["true"] },
  ],
});

const sg = new aws.ec2.SecurityGroup("codenames-sg", {
  vpcId: vpc.id,
  description: "Nombres Clave: HTTP/HTTPS publicos",
  ingress: [
    { protocol: "tcp", fromPort: 80, toPort: 80, cidrBlocks: ["0.0.0.0/0"], ipv6CidrBlocks: ["::/0"], description: "HTTP (redirige a HTTPS y valida ACME)" },
    { protocol: "tcp", fromPort: 443, toPort: 443, cidrBlocks: ["0.0.0.0/0"], ipv6CidrBlocks: ["::/0"], description: "HTTPS + WebSocket" },
    ...(openTestPort
      ? [{ protocol: "tcp", fromPort: 3000, toPort: 3000, cidrBlocks: ["0.0.0.0/0"], description: "Prueba directa antes de configurar el DNS" }]
      : []),
    ...(sshCidr ? [{ protocol: "tcp", fromPort: 22, toPort: 22, cidrBlocks: [sshCidr], description: "SSH" }] : []),
  ],
  egress: [{ protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"], ipv6CidrBlocks: ["::/0"] }],
  tags: { Name: "codenames" },
});

// ── 4. Instancia ────────────────────────────────────────────────────────
const arch = instanceType.startsWith("t4g") || instanceType.startsWith("m6g") ? "arm64" : "x86_64";
const ami = aws.ssm.getParameterOutput({
  name: `/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-6.1-${arch}`,
}).value;

const userData = pulumi
  .all([bucket.bucket, appObject.key])
  .apply(([bucketName, key]) =>
    fs
      .readFileSync(path.join(__dirname, "user-data.sh"), "utf8")
      .replace("__BUCKET__", bucketName)
      .replace("__KEY__", key)
      .replace("__DOMAIN__", domain)
      .replace("__EMAIL__", acmeEmail),
  );

const server = new aws.ec2.Instance("codenames", {
  ami,
  instanceType,
  subnetId: subnets.ids[0],
  vpcSecurityGroupIds: [sg.id],
  iamInstanceProfile: instanceProfile.name,
  associatePublicIpAddress: true,
  userData,
  userDataReplaceOnChange: true, // app nueva → instancia nueva, sin pasos manuales
  rootBlockDevice: { volumeSize: 8, volumeType: "gp3", encrypted: true, deleteOnTermination: true },
  metadataOptions: { httpTokens: "required", httpEndpoint: "enabled" },
  tags: { Name: "codenames", App: "nombres-clave" },
});

const eip = new aws.ec2.Eip("codenames-ip", { domain: "vpc", instance: server.id, tags: { Name: "codenames" } });

// ── 5. Salidas ──────────────────────────────────────────────────────────
export const ip = eip.publicIp;
export const url = `https://${domain}`;
export const dnsRecord = pulumi.interpolate`Cloudflare · A · ${domain.split(".")[0]} → ${eip.publicIp} (DNS only, nube gris)`;
export const pruebaDirecta = pulumi.interpolate`http://${eip.publicIp}:3000`;
export const consola = pulumi.interpolate`aws ssm start-session --target ${server.id} --region ${aws.config.region}`;
export const logDeArranque = pulumi.interpolate`sudo tail -f /var/log/codenames-boot.log  (dentro de ${server.id})`;
export const version = appHash;
