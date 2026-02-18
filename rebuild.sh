docker compose down
docker builder prune -a
docker compose build --parallel=false --no-cache
docker compose up -d

