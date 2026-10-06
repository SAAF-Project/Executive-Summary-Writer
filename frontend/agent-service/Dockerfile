FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PORT=8000 AGENT_HOSTED=1
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py presentation.py ./
COPY upstream ./upstream
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]
