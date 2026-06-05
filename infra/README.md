# Despliegue de CoRetingCar (AWS · Docker · GitHub Actions)

Backend Node/Express + SQLite en **AWS EC2 t3.micro** (free-tier) con **Docker** y **Caddy** (HTTPS
automático Let's Encrypt — el mismo enfoque "Let's Encrypt en el servidor" que CoBaby, pero
auto-renovable). Infra con **Terraform** (estado en S3) y CI/CD con **GitHub Actions**.
Región: **eu-west-1 (Irlanda)**. Dominio: **`api.corentingcar.uk`** (DNS en Cloudflare).

```
push a main ─► deploy.yml ─► docker build → save|gzip → SCP/SSH (.pem) → compose up (api + Caddy)
Run Infra  ─► infra.yml  ─► terraform apply → EC2 t3.micro + Elastic IP + SG (eu-west-1)
Cloudflare ─► A: api.corentingcar.uk → Elastic IP (DNS only)
```

## Coste
- EC2 **t3.micro**: gratis 750 h/mes durante **12 meses**. EBS 30 GB: dentro del free-tier.
- **IPv4 pública (Elastic IP)**: AWS cobra **~3,5–4 €/mes**. → En la práctica **~3–4 €/mes**.

## GitHub Secrets (Settings → Secrets and variables → Actions)

| Secret | Valor / de dónde sale |
|---|---|
| `AWS_ACCESS_KEY_ID` | De **`CoBaby API/.env` línea 9 (`ACces`)** |
| `AWS_SECRET_ACCESS_KEY` | De **`CoBaby API/.env` línea 11 (`secret`)** |
| `EC2_HOST` | La **public_ip** que imprime el workflow Infra |
| `EC2_SSH_KEY` | Contenido de `infra/keys/coretingcar_ec2` (clave privada) |
| `API_DOMAIN` | `api.corentingcar.uk` |
| `SESSION_TOKEN_SECRET` | Secreto largo aleatorio (**obligatorio**) |
| `CORS_ORIGINS` | (opcional, por defecto `*`) |
| `USER1_PIN` / `USER2_PIN` | (opcional `1234`/`5678`; solo en el 1er seed) |
| `ANCHOR_DATE` | (opcional, por defecto `2025-01-01`) |

> ⚠️ Las claves de CoBaby deben tener permisos para crear **EC2/VPC/EIP/S3**. Si el workflow Infra
> falla con `AccessDenied`, hay que ampliar la política del IAM user (p.ej. `AmazonEC2FullAccess` +
> `AmazonS3FullAccess`).

Generar un `SESSION_TOKEN_SECRET` (PowerShell):
```powershell
-join ((48..57)+(65..90)+(97..122) | Get-Random -Count 48 | ForEach-Object {[char]$_})
```
Copiar la clave privada al portapapeles sin mostrarla:
```powershell
Get-Content infra/keys/coretingcar_ec2 -Raw | Set-Clipboard
```

## Runbook (una vez)

1. **Push** del repo a `aymartel/corentingcar` (rama `main`).
2. Añade los Secrets `AWS_ACCESS_KEY_ID` y `AWS_SECRET_ACCESS_KEY` (de CoBaby `.env`).
3. GitHub → Actions → **Infra (Terraform)** → *Run workflow*. Crea EC2 + Elastic IP.
   Copia la **public_ip** del resumen del run.
4. **Cloudflare** (dominio `corentingcar.uk`) → DNS → *Add record*:
   - **Type**: `A` · **Name**: `api` · **IPv4**: la **public_ip** del EC2.
   - **Proxy status**: **DNS only** (nube **gris**, NO naranja). *Imprescindible* para que Caddy
     pueda emitir el certificado Let's Encrypt (reto HTTP-01 por el puerto 80).
   - TTL: Auto.
5. Añade el resto de Secrets: `EC2_HOST` (= public_ip), `EC2_SSH_KEY` (clave privada),
   `API_DOMAIN` (`api.corentingcar.uk`), `SESSION_TOKEN_SECRET` (y opcionales).
6. GitHub → Actions → **Deploy app (EC2)** → *Run workflow* (o haz un push a `main`). Caddy obtendrá
   el certificado HTTPS automáticamente (tarda ~30–60 s la primera vez).
7. Verifica: `https://api.corentingcar.uk/api/health` → `{"ok":true,...}`.

> Sin el paso 4 (DNS apuntando a la IP, **nube gris**) Caddy no puede emitir el certificado.

### Cloudflare proxied (nube naranja) — opcional, más adelante
Si quieres ocultar la IP y usar la CDN de Cloudflare (nube naranja), el reto HTTP-01 deja de
funcionar; habría que cambiar Caddy al reto **DNS-01** con un **API token de Cloudflare**
(imagen `caddy` con el plugin `caddy-dns/cloudflare`). Para empezar, usa **DNS only**.

## La app Flutter
```bash
flutter build apk --release --dart-define=API_URL=https://api.corentingcar.uk
```

## Operación
- **SSH**: `ssh -i infra/keys/coretingcar_ec2 ec2-user@<public_ip>`
- **Logs**: `cd ~/coretingcar && docker compose logs -f` (api y caddy)
- **Backup SQLite**:
  ```bash
  scp -i infra/keys/coretingcar_ec2 ec2-user@<ip>:/home/ec2-user/coretingcar/data/coche.db ./backup-coche.db
  ```
- **Cambiar un PIN en producción**:
  ```bash
  ssh -i infra/keys/coretingcar_ec2 ec2-user@<ip> \
    "cd ~/coretingcar && docker compose exec api node dist/db/set-pin.js user1 4321"
  ```

## Seguridad
- **Restringe el SSH** a tu IP: en GitHub define `ssh_cidr` o edita `infra/terraform/variables.tf`
  (`default = "TU_IP/32"`). Por defecto está abierto (`0.0.0.0/0`).
- La clave **privada** (`infra/keys/coretingcar_ec2`) está en `.gitignore`: nunca se versiona.
- IMDSv2 obligatorio en la instancia (ya configurado).

## Persistencia
- La BD vive en `~/coretingcar/data/coche.db` (bind mount). **Sobrevive a los redeploys** del
  contenedor; solo se perdería si se destruye/recrea la instancia (de ahí los backups).
- En el primer arranque con BD vacía, el contenedor ejecuta migración + seed (Andy/Dennis + reglas).

## Destruir
`terraform -chdir=infra/terraform destroy` (con las mismas credenciales) o un workflow de destroy.
