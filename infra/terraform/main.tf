provider "aws" {
  region = var.aws_region
}

# VPC y subredes por defecto (las que ya existen en la cuenta) → infra mínima.
data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

# AMI más reciente de Amazon Linux 2023 (x86_64) vía parámetro público de SSM.
data "aws_ssm_parameter" "al2023" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}
