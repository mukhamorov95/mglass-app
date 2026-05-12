-- B2B calculation attachments: stores files linked to b2b_orders
CREATE TABLE IF NOT EXISTS b2b_calculation_attachments (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    int         REFERENCES b2b_orders(id) ON DELETE CASCADE,
  file_name   text        NOT NULL,
  file_url    text        NOT NULL,
  file_type   text,
  file_size   int,
  uploaded_by text,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS b2b_calc_attach_order_idx ON b2b_calculation_attachments(order_id);

ALTER TABLE b2b_calculation_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users manage b2b attachments"
  ON b2b_calculation_attachments FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Supabase Storage bucket for B2B file uploads (25 MB limit)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'b2b-attachments',
  'b2b-attachments',
  false,
  26214400,
  ARRAY[
    'image/jpeg', 'image/png', 'image/heic', 'image/heif',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Auth upload b2b attachments"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'b2b-attachments');

CREATE POLICY "Auth read b2b attachments"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'b2b-attachments');

CREATE POLICY "Auth delete b2b attachments"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'b2b-attachments');
