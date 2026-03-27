# Dockerfile for enroller service (Nmap + Scrapli worker + FastAPI)
FROM python:3.12-slim
RUN echo "deb http://mirror.us-east-1.aws.debian.org/debian trixie main" > /etc/apt/sources.list && \
    echo "deb http://mirror.us-east-1.aws.debian.org/debian trixie-updates main" >> /etc/apt/sources.list && \
    echo "deb http://mirror.us-east-1.aws.debian.org/debian-security trixie-security main" >> /etc/apt/sources.list && \
    apt-get update && apt-get install -y --no-install-recommends nmap && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app/ ./app/
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8002"]
