FROM alpine:3.20
# mariadb-client provides a mysqldump compatible with MySQL 8; rclone uploads to R2.
RUN apk add --no-cache mariadb-client rclone gzip
COPY backup.sh /usr/local/bin/backup.sh
RUN chmod +x /usr/local/bin/backup.sh
ENTRYPOINT ["/usr/local/bin/backup.sh"]
