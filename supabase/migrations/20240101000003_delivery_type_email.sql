ALTER TABLE delivery_destinations DROP CONSTRAINT delivery_destinations_type_check;
ALTER TABLE delivery_destinations ADD CONSTRAINT delivery_destinations_type_check
  CHECK (type = ANY (ARRAY['slack'::text, 'notion'::text, 'todoist'::text, 'email_digest'::text, 'email'::text]));
