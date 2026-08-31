FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
RUN pip install --no-cache-dir uv

WORKDIR /srv
COPY engine/ /srv/engine/
COPY server/ /srv/server/
RUN uv pip install --system -e "/srv/engine[dev]" -e "/srv/server[dev]"

WORKDIR /srv/server
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
