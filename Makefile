.PHONY: dev start build db-init backfill hash-password

dev:
	npm run dev

start:
	npm run start

build:
	docker-compose build

up:
	docker-compose up

down:
	docker-compose down

db-init:
	npm run db:init

backfill:
	npm run backfill

hash-password:
	npm run hash-password
