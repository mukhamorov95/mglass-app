-- Write policy for mirror_lighting_components (was missing from initial catalog_write_policies)
CREATE POLICY "Auth manage mirror lighting"
  ON public.mirror_lighting_components FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
