# words

Angol-magyar szotanulo app PostgreSQL alappal, SRS gyakorlassal, napi celokkal es hibafuzettel.

## Fobb funkciok
- Szokartyak, gepelos kviz, feleletvalasztos, parositas
- SRS (spaced repetition) utemezes
- Napi celok (uj szo + ismetles)
- Hibafuzet (legtobbet rontott szavak)
- CSV import DB-be (UI-bol)
- Nehez szavak szuro + esedekes (due) szuro

## Adatbazis
Egy PostgreSQL szervert tobb app is hasznalhat biztonsagosan, ha kulon DB + kulon user van apponkent.

SQL (egyszer futtasd a postgresben):

```sql
CREATE USER words_user WITH PASSWORD 'DFRGcdcscaasd432!';
CREATE DATABASE words_db OWNER words_user;
GRANT ALL PRIVILEGES ON DATABASE words_db TO words_user;
```

## Docker futtatas
Ez a projekt a mar letezo external halot hasznalja: `my-shared-network`.

Inditas:

```bash
docker compose up -d --build
```

Proxy beallitas (Nginx Proxy Manager):
- Forward Hostname/IP: `angolwords-app`
- Forward Port: `3000`
- Scheme: `http`

## Fontos
A `docker-compose.yml` jelenleg ezt hasznalja:

```env
DATABASE_URL=postgres://words_user:DFRGcdcscaasd432!@blog-db-1:5432/words_db
```

Ha a postgres kontenered neve/hostja mas, ezt a host reszt modositsd.
