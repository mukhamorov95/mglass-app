-- Write policies for catalog tables (admin operations)
-- Authenticated users can manage catalog entries

CREATE POLICY "Auth manage materials"
  ON public.materials FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "Auth manage services"
  ON public.services FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "Auth manage hardware"
  ON public.hardware_items FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "Auth manage mirror lighting"
  ON public.mirror_lighting_components FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
