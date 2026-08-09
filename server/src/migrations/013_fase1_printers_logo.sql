-- Fase 1: impressoras, perfil de impressão e logo da loja
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('store_logo_filename', ''),
  ('store_logo_mime', ''),
  ('printer_use_windows_default', '1'),
  ('printer_receipt_name', ''),
  ('printer_reports_name', ''),
  ('printer_default_name', ''),
  ('print_profile_format', 'A4'),
  ('print_profile_copies', '1'),
  ('print_profile_auto', '0'),
  ('print_profile_mode', 'manual');
