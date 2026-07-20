output "public_ip" {
  description = "IP pública (Elastic IP). Cópiala al secret EC2_HOST y apunta tu DNS A aquí."
  value       = aws_eip.api.public_ip
}

output "instance_id" {
  value = aws_instance.api.id
}

output "ssh_command" {
  description = "Comando para conectarte por SSH."
  value       = "ssh -i infra/keys/coretingcar_ec2 ec2-user@${aws_eip.api.public_ip}"
}

output "backup_policy_id" {
  description = "ID de la politica DLM de snapshots diarios."
  value       = aws_dlm_lifecycle_policy.ebs_daily.id
}
