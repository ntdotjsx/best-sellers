CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    platform VARCHAR(32) NOT NULL DEFAULT 'shopee',
    keyword VARCHAR(255) NOT NULL,
    link TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    price TEXT NOT NULL DEFAULT '',
    rating TEXT NOT NULL DEFAULT '',
    img TEXT NOT NULL DEFAULT '',
    shipping TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    total_rating BIGINT NOT NULL DEFAULT 0,
    detailed_rating JSONB NOT NULL DEFAULT '{}'::jsonb,
    comments JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (platform, keyword, link)
);

CREATE INDEX IF NOT EXISTS idx_products_platform_keyword ON products (platform, keyword);
CREATE INDEX IF NOT EXISTS idx_products_link ON products (link);
