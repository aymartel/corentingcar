terraform {
  required_version = ">= 1.10.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Estado remoto en S3 (CI es efímero). El `bucket` y la `region` se pasan por
  # -backend-config en el workflow de GitHub Actions. Bloqueo nativo de S3 (TF >= 1.10).
  backend "s3" {
    key          = "coretingcar/terraform.tfstate"
    encrypt      = true
    use_lockfile = true
  }
}
