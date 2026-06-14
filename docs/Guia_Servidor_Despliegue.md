# Guía de servidor y despliegue — MundoTec ERP

Servidor: **Ubuntu/Debian**, con **dominio público**, para **desarrollo + producción**.

## 1. Topología

Todo corre en contenedores Docker detrás de un proxy inverso (Nginx):

```
Internet ──HTTPS──► Nginx (80/443)
                     ├─ tienda.midominio.com ─► web-store (público) + /api/ (BFF, rate limit)
                     └─ erp.midominio.com ─────► web-erp + /api/   (restringido por IP/VPN)
Red privada (sin internet): api ─► db (PostgreSQL)   ·   fiscal ─► db / Hacienda
```

- La **base de datos nunca se expone** (sin puertos publicados; red Docker `internal`).
- La **tienda** es pública; el **ERP** se restringe a tu LAN/VPN en Nginx.
- El **microservicio fiscal** es interno.

## 2. Dos entornos en el mismo servidor (aislados)

Aunque sea un solo servidor, separa producción y desarrollo en carpetas y bases distintas:

```
/srv/erp-prod   → rama main,    .env de producción, base mundotec_erp
/srv/erp-dev    → rama develop, .env de dev,        base mundotec_erp_dev
```

Cada uno con su propio `docker-compose.yml` y `.env`. Usa puertos/dominios distintos
(p. ej. `dev.tienda.midominio.com`). Así las pruebas nunca tocan datos reales.

## 3. Pasos de instalación

1. **Preparar el servidor:** `sudo bash install_server.sh` (instala Docker, Compose, firewall, fail2ban).
2. **Clonar el repo** en `/srv/erp-prod` (y `/srv/erp-dev`).
3. **Configurar variables:** copia `.env.example` a `.env` y complétalo (claves fuertes, dominios).
4. **DNS:** apunta `tienda.midominio.com` y `erp.midominio.com` a la IP pública del servidor.
5. **TLS (HTTPS):** emite certificados con certbot:
   ```bash
   docker compose run --rm certbot certonly --webroot -w /var/www/certbot \
     -d tienda.midominio.com -d erp.midominio.com
   ```
6. **Levantar:** `docker compose up -d --build`.
7. **Migraciones/seed:** ejecutar las migraciones del backend (ver CLAUDE.md).

## 4. Seguridad (producción con cara pública)

- Base de datos en red privada, sin puertos al host; usuario de DB con permisos mínimos para el camino público.
- ERP restringido por IP/VPN en Nginx (no abierto a internet); tienda con WAF/rate limiting.
- HTTPS en todo; HSTS; firewall solo 22/80/443; SSH con llaves (deshabilitar password).
- Llaves y secretos (Hacienda .p12, BAC, JWT) fuera del repo, en `.env`/gestor de secretos.
- Actualizaciones de seguridad automáticas (`unattended-upgrades`).

## 5. Respaldos

- Respaldo diario de PostgreSQL (cron):
  ```bash
  0 2 * * * docker exec erp-prod-db-1 pg_dump -U erp_app mundotec_erp | gzip > /srv/backups/erp_$(date +\%F).sql.gz
  ```
- Retención (p. ej. 30 días) y copia fuera del servidor (almacenamiento externo/nube).
- Prueba periódica de restauración.

## 6. CI/CD (flujo sugerido)

- Repositorio Git con ramas `main` (prod) y `develop` (dev).
- Pipeline (GitHub Actions/GitLab CI): build + pruebas en cada push.
- Despliegue: al hacer merge a `main`, el servidor hace `git pull` y `docker compose up -d --build`
  (vía webhook o `ssh`), entorno `/srv/erp-prod`.
- Claude Code puede correr en el servidor o en local; los cambios entran por PR y se despliegan por el pipeline.

## 7. Recursos recomendados (orientativo)

- Para empezar: 4 vCPU, 8 GB RAM, 80+ GB SSD. Escalar según uso.
- Monitoreo básico (uso de CPU/disco) y alertas; logs centralizados de los contenedores.
