-- 포트폴리오 프로젝트 공통 초기화 SQL
-- 각 프로젝트가 실제 사용할 테이블은 각자의 Flyway/Liquibase 마이그레이션으로 관리
-- 여기서는 DB와 권한만 초기화

CREATE DATABASE IF NOT EXISTS event_pipeline CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS api_server CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS crawler_engine CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

GRANT ALL PRIVILEGES ON event_pipeline.* TO 'portfolio'@'%';
GRANT ALL PRIVILEGES ON api_server.* TO 'portfolio'@'%';
GRANT ALL PRIVILEGES ON crawler_engine.* TO 'portfolio'@'%';
FLUSH PRIVILEGES;
