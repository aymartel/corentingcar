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

variable "backup_retention_days" {
  type        = number
  default     = 7
  description = "Numero de snapshots diarios a conservar (los mas antiguos se borran solos)."

  validation {
    condition     = var.backup_retention_days >= 1 && var.backup_retention_days <= 1000
    error_message = "backup_retention_days debe estar entre 1 y 1000."
  }
}

variable "backup_time_utc" {
  type        = string
  default     = "03:00"
  description = "Hora UTC (HH:MM) del snapshot diario. 03:00 UTC = 04:00/05:00 en Espana."

  validation {
    condition     = can(regex("^([01][0-9]|2[0-3]):[0-5][0-9]$", var.backup_time_utc))
    error_message = "backup_time_utc debe tener formato HH:MM en 24h (ej. 03:00)."
  }
}
