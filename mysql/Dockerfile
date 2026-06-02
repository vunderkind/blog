FROM mysql:8.0

# Bind on all addresses incl. IPv6 so Fly private networking (<app>.internal,
# which resolves to a 6PN IPv6 address) can reach it. Default to utf8mb4
# (Ghost requires it). Memory-tuned for a tiny DB on a small VM.
CMD ["mysqld", \
     "--bind-address=*", \
     "--character-set-server=utf8mb4", \
     "--collation-server=utf8mb4_general_ci", \
     "--performance-schema=OFF", \
     "--innodb-buffer-pool-size=256M", \
     "--max-connections=50"]
