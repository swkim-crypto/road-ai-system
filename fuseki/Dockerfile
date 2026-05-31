# 도로대장 Fuseki + TDB2 + GeoSPARQL (데이터를 이미지에 구워 배포)
# 빌드 시점에 TTL → TDB2 적재 → 이미지에 포함. 재배포 = 데이터 갱신.
# 영속 디스크 불필요(읽기전용 모델). 갱신은 git push 로 TTL 교체 후 재배포.

FROM eclipse-temurin:17-jre

ARG JENA_VERSION=5.6.0
ENV JENA_HOME=/opt/apache-jena-${JENA_VERSION}
ENV FUSEKI_HOME=/opt/apache-jena-fuseki-${JENA_VERSION}
ENV PATH=${JENA_HOME}/bin:${PATH}

# --- Jena + Fuseki 내려받기 (archive: 5.x 계열) ---
RUN apt-get update && apt-get install -y curl unzip && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL -o /tmp/jena.zip   https://archive.apache.org/dist/jena/binaries/apache-jena-${JENA_VERSION}.zip \
 && curl -fsSL -o /tmp/fuseki.zip https://archive.apache.org/dist/jena/binaries/apache-jena-fuseki-${JENA_VERSION}.zip \
 && unzip -q /tmp/jena.zip   -d /opt \
 && unzip -q /tmp/fuseki.zip -d /opt \
 && rm /tmp/*.zip

WORKDIR /data

# --- 적재 입력: 정규화된 데이터 + TBox 2개 + Fuseki 설정 ---
#   loaded.ttl 은 ingest_normalize.py 로 미리 만든 결과를 레포에 포함시켜 둔다.
COPY loaded.ttl road-ledger-core.ttl road-ledger-classes.ttl ./
COPY road-geosparql.ttl ./

# --- 빌드 시점에 TDB2 적재 (이미지에 데이터가 구워짐) ---
RUN ${JENA_HOME}/bin/tdb2.tdbloader --loc=/data/databases/road-tdb2 \
      road-ledger-core.ttl road-ledger-classes.ttl loaded.ttl

# Render 가 주입하는 $PORT 로 기동. 첫 기동 시 공간 인덱스 자동 생성.
ENV PORT=3030  # private service 고정 포트 (FUSEKI_URL 과 일치)
EXPOSE 3030
CMD ["sh","-c","${FUSEKI_HOME}/fuseki-server --port=${PORT} --config=/data/road-geosparql.ttl"]
