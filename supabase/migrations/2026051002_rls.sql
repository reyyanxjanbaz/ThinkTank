-- Enable RLS on core tables
alter table if exists profiles enable row level security;
alter table if exists sessions enable row level security;
alter table if exists turns enable row level security;
alter table if exists artifacts enable row level security;
alter table if exists exports enable row level security;
alter table if exists retention_events enable row level security;

-- Profiles
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'profiles_owner'
  ) THEN
    CREATE POLICY profiles_owner ON profiles
      FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- Sessions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'sessions'
      AND policyname = 'sessions_owner'
  ) THEN
    CREATE POLICY sessions_owner ON sessions
      FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- Turns
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'turns'
      AND policyname = 'turns_owner'
  ) THEN
    CREATE POLICY turns_owner ON turns
      FOR ALL
      USING (
        auth.uid() = (
          SELECT user_id FROM sessions WHERE sessions.id = turns.session_id
        )
      )
      WITH CHECK (
        auth.uid() = (
          SELECT user_id FROM sessions WHERE sessions.id = turns.session_id
        )
      );
  END IF;
END $$;

-- Artifacts
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'artifacts'
      AND policyname = 'artifacts_owner'
  ) THEN
    CREATE POLICY artifacts_owner ON artifacts
      FOR ALL
      USING (
        auth.uid() = (
          SELECT user_id FROM sessions WHERE sessions.id = artifacts.session_id
        )
      )
      WITH CHECK (
        auth.uid() = (
          SELECT user_id FROM sessions WHERE sessions.id = artifacts.session_id
        )
      );
  END IF;
END $$;

-- Exports
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'exports'
      AND policyname = 'exports_owner'
  ) THEN
    CREATE POLICY exports_owner ON exports
      FOR ALL
      USING (
        auth.uid() = (
          SELECT user_id FROM sessions WHERE sessions.id = exports.session_id
        )
      )
      WITH CHECK (
        auth.uid() = (
          SELECT user_id FROM sessions WHERE sessions.id = exports.session_id
        )
      );
  END IF;
END $$;

-- Retention events
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'retention_events'
      AND policyname = 'retention_owner'
  ) THEN
    CREATE POLICY retention_owner ON retention_events
      FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- Storage buckets and policies
DO $$
BEGIN
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'artifacts') THEN
      INSERT INTO storage.buckets (id, name, public)
      VALUES ('artifacts', 'artifacts', FALSE);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'exports') THEN
      INSERT INTO storage.buckets (id, name, public)
      VALUES ('exports', 'exports', FALSE);
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'Skipping storage bucket creation.';
  END;

  BEGIN
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'Skipping storage.objects RLS enable.';
  END;

  BEGIN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'storage'
        AND tablename = 'objects'
        AND policyname = 'artifacts_owner'
    ) THEN
      CREATE POLICY artifacts_owner ON storage.objects
        FOR ALL
        USING (
          bucket_id = 'artifacts'
          AND auth.uid()::text = (storage.foldername(name))[1]
        )
        WITH CHECK (
          bucket_id = 'artifacts'
          AND auth.uid()::text = (storage.foldername(name))[1]
        );
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'storage'
        AND tablename = 'objects'
        AND policyname = 'exports_owner'
    ) THEN
      CREATE POLICY exports_owner ON storage.objects
        FOR ALL
        USING (
          bucket_id = 'exports'
          AND auth.uid()::text = (storage.foldername(name))[1]
        )
        WITH CHECK (
          bucket_id = 'exports'
          AND auth.uid()::text = (storage.foldername(name))[1]
        );
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'Skipping storage object policies.';
  END;
END $$;
