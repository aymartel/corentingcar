variable "aws_region" {
  type        = string
  default     = "eu-west-1"
  description = "Región AWS (Irlanda: baja latencia desde España, free-tier)."
}

variable "project" {
  type        = string
  default     = "coretingcar"
  description = "Prefijo de nombres de recursos."
}

variable "key_name" {
  type        = string
  default     = "coretingcar-ec2"
  description = "Nombre del key pair en AWS (clave pública en infra/keys/coretingcar_ec2.pub)."
}

variable "instance_type" {
  type        = string
  default     = "t3.micro"
  description = "Tipo de instancia (t3.micro = free-tier 12 meses)."
}

variable "ssh_cidr" {
  type        = string
  default     = "0.0.0.0/0"
  description = "CIDR permitido para SSH (puerto 22). RECOMENDADO: tu_ip_publica/32."
}
