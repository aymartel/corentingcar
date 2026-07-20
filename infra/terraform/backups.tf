# Snapshots automáticos del volumen raíz (donde vive la base SQLite) mediante
# Amazon Data Lifecycle Manager (DLM): programación nativa de AWS, sin Lambda ni
# cron en la instancia. DLM no tiene coste; solo pagas el almacenamiento de los
# snapshots (~0,05 $/GB-mes en eu-west-1, e incrementales: tras el primero, cada
# snapshot solo guarda los bloques que cambiaron).

# Rol que DLM asume para crear y borrar snapshots en tu nombre.
data "aws_iam_policy_document" "dlm_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["dlm.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "dlm" {
  name               = "${var.project}-dlm-lifecycle"
  assume_role_policy = data.aws_iam_policy_document.dlm_assume_role.json
  tags               = { Name = "${var.project}-dlm-lifecycle" }
}

# Política gestionada por AWS con los permisos exactos que DLM necesita.
resource "aws_iam_role_policy_attachment" "dlm" {
  role       = aws_iam_role.dlm.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSDataLifecycleManagerServiceRole"
}

resource "aws_dlm_lifecycle_policy" "ebs_daily" {
  # OJO: DLM solo admite [0-9A-Za-z _-] aqui (nada de ":" ni acentos).
  description        = "${var.project} snapshot diario del volumen raiz"
  execution_role_arn = aws_iam_role.dlm.arn
  state              = "ENABLED"

  policy_details {
    resource_types = ["VOLUME"]

    # Se aplica a cualquier volumen etiquetado Backup=true (ver root_block_device en ec2.tf).
    target_tags = {
      Backup = "true"
    }

    schedule {
      name = "Diario-${var.backup_retention_days}d"

      create_rule {
        interval      = 24
        interval_unit = "HOURS"
        # Hora UTC. DLM la trata como ventana aproximada (puede ejecutarse dentro
        # de la hora siguiente), por eso conviene una hora de bajo trafico.
        times = [var.backup_time_utc]
      }

      retain_rule {
        count = var.backup_retention_days
      }

      # Copia los tags del volumen al snapshot (util para filtrar en Cost Explorer).
      copy_tags = true

      tags_to_add = {
        SnapshotCreator = "DLM"
        Project         = var.project
      }
    }
  }

  tags = { Name = "${var.project}-dlm-daily" }
}
