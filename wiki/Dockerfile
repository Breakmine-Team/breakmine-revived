FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    WIKI_DATA_DIR=/data

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py index.html 404.html ./
COPY templates ./templates
COPY static ./static

# Seed the data volume. Docker only copies image content into a named volume the
# first time that volume is created, so existing pages/mods are kept on rebuilds
# but live edits in the volume are never overwritten by the image.
COPY wiki.db /data/wiki.db
COPY mod_files /data/mod_files

RUN useradd --uid 1000 --create-home --shell /usr/sbin/nologin wiki \
 && mkdir -p /data/temp_mods /data/mod_images \
 && chown -R wiki:wiki /data /app

USER wiki

VOLUME ["/data"]
EXPOSE 8001 8004

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python3 -c "import os,urllib.request as r,sys;w=os.getenv('WIKI_PORT') or os.getenv('PORT') or '8001';m=os.getenv('MODS_PORT') or '8004';sys.exit(0 if all(r.urlopen('http://127.0.0.1:'+p+q,timeout=3).status==200 for p,q in ((w,'/all'),(m,'/'))) else 1)"

CMD ["python3", "app.py"]
