-- Etapa 5: versão 1.0.0 e metadados de release
INSERT OR REPLACE INTO settings (key, value, updated_at)
VALUES ('app_version', '1.0.0', datetime('now'));

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('app_name', 'ONÇA PDV'),
  ('app_build', '2026.08.08');
