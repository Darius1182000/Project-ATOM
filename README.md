
# Configure the project: 

- `npm install`

# Run the project:

- Download Docker Desktop
- In your IDE run `docker-compose up -d --build` in terminal

# Commands:

- Start docker containers: `docker-compose up -d`
- Stop docker containers: `docker compose down`
- Stop docker containers and clear data: `docker compose down --volumes`
- Rebuild docker containers: `docker-compose up -d --build`
- Rebuild projectatom-discord-bot docker image: `docker build -t projectatom-discord-bot .` 
- Rebuild lavalink docker image: `docker build -t ghcr.io/lavalink-devs/lavalink .`

# Format (Prettier vs code):

- `CTRL + SHIFT + P` and search "Format Document"
- `SHIFT + ALT + F` to format the document you are in

# Docs:

- https://tomato6966.github.io/lavalink-client/home/installation