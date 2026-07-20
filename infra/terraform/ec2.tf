# Key pair (la clave PÚBLICA se versiona; la privada va en el secret EC2_SSH_KEY de GitHub).
resource "aws_key_pair" "ec2" {
  key_name   = var.key_name
  public_key = file("${path.module}/../keys/coretingcar_ec2.pub")
}

resource "aws_security_group" "api" {
  name        = "${var.project}-sg"
  description = "CoRetingCar API: SSH, HTTP, HTTPS"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.ssh_cidr]
  }
  ingress {
    description = "HTTP (Caddy / ACME)"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    description = "HTTPS (Caddy)"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.project}-sg" }
}

resource "aws_instance" "api" {
  ami                    = nonsensitive(data.aws_ssm_parameter.al2023.value)
  instance_type          = var.instance_type
  subnet_id              = data.aws_subnets.default.ids[0]
  vpc_security_group_ids = [aws_security_group.api.id]
  key_name               = aws_key_pair.ec2.key_name
  user_data              = file("${path.module}/user_data.sh")

  root_block_device {
    volume_size = 30
    volume_type = "gp3"

    # El tag Backup=true es el que busca la política de snapshots (backups.tf).
    tags = {
      Name   = "${var.project}-root"
      Backup = "true"
    }
  }

  # IMDSv2 obligatorio (buena práctica de seguridad).
  metadata_options {
    http_tokens = "required"
  }

  tags = { Name = "${var.project}-api" }

  # No recrear la instancia si Amazon publica una AMI nueva.
  lifecycle {
    ignore_changes = [ami]
  }
}

# IP pública fija (estable entre stop/start). NOTA: AWS cobra ~3,5 €/mes por IPv4 pública.
resource "aws_eip" "api" {
  instance = aws_instance.api.id
  domain   = "vpc"
  tags     = { Name = "${var.project}-eip" }
}
