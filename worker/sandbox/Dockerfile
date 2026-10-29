FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONPATH=/opt
RUN pip install --no-cache-dir numpy pandas
COPY relay_ta.py /opt/relay_ta.py
COPY harness.py /harness.py
COPY analyze.py /analyze.py
COPY probe.py /probe.py
USER 65534:65534
WORKDIR /tmp
ENTRYPOINT ["python","/harness.py"]