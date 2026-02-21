DO
$$
DECLARE
    r RECORD;
BEGIN
    -- Disable triggers (including FK constraints)
    EXECUTE 'SET session_replication_role = replica';

    FOR r IN
        SELECT schemaname, tablename
        FROM pg_tables
        WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
    LOOP
        EXECUTE format(
            'TRUNCATE TABLE %I.%I RESTART IDENTITY CASCADE;',
            r.schemaname,
            r.tablename
        );
    END LOOP;

    -- Re-enable triggers
    EXECUTE 'SET session_replication_role = DEFAULT';
END
$$;