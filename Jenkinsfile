pipeline {
  agent any

  options {
    timestamps()
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '10', artifactNumToKeepStr: '5'))
    timeout(time: 30, unit: 'MINUTES')
  }

  environment {
    APP_IMAGE         = 'student-attendance'
    TEST_IMAGE        = 'student-attendance-tests'
    CI_NETWORK        = "attendance-ci-${BUILD_NUMBER}"
    APP_CONTAINER     = "attendance-ci-${BUILD_NUMBER}"
    SELENIUM_CONTAINER = "selenium-ci-${BUILD_NUMBER}"
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
        sh '''
          echo "Building commit: $(git rev-parse --short HEAD)"
          git log -1 --pretty=format:'%h %s%n'
        '''
      }
    }

    stage('API tests') {
      steps {
        sh '''
          set -eu
          docker build -f Dockerfile.test -t "$TEST_IMAGE:$BUILD_NUMBER" .
          docker run --rm "$TEST_IMAGE:$BUILD_NUMBER" npm run test:api
        '''
      }
    }

    stage('Build application image') {
      steps {
        sh '''
          set -eu
          docker build -t "$APP_IMAGE:$BUILD_NUMBER" -t "$APP_IMAGE:latest" .
          docker image inspect "$APP_IMAGE:$BUILD_NUMBER" > /dev/null
          echo "Built $APP_IMAGE:$BUILD_NUMBER"
        '''
      }
    }

    stage('Selenium E2E') {
      steps {
        sh '''
          set -eu

          cleanup() {
            docker rm -f "$APP_CONTAINER" "$SELENIUM_CONTAINER" >/dev/null 2>&1 || true
            docker network rm "$CI_NETWORK" >/dev/null 2>&1 || true
          }
          trap cleanup EXIT

          docker network create "$CI_NETWORK"

          docker run -d \
            --name "$APP_CONTAINER" \
            --network "$CI_NETWORK" \
            -e SEED_DEMO=true \
            -e DB_PATH=/app/data/attendance.db \
            "$APP_IMAGE:$BUILD_NUMBER"

          docker run -d \
            --name "$SELENIUM_CONTAINER" \
            --network "$CI_NETWORK" \
            --shm-size=2g \
            selenium/standalone-chrome:latest

          app_ready=0
          for i in $(seq 1 60); do
            if docker run --rm --network "$CI_NETWORK" curlimages/curl:latest \
                 -fsS "http://$APP_CONTAINER:3000/api/health" >/dev/null 2>&1; then
              app_ready=1
              break
            fi
            sleep 2
          done
          if [ "$app_ready" -ne 1 ]; then
            echo "Application container did not become healthy."
            docker logs "$APP_CONTAINER" || true
            exit 1
          fi

          selenium_ready=0
          for i in $(seq 1 60); do
            if docker run --rm --network "$CI_NETWORK" curlimages/curl:latest \
                 -fsS "http://$SELENIUM_CONTAINER:4444/wd/hub/status" >/dev/null 2>&1; then
              selenium_ready=1
              break
            fi
            sleep 2
          done
          if [ "$selenium_ready" -ne 1 ]; then
            echo "Selenium grid did not become ready."
            docker logs "$SELENIUM_CONTAINER" || true
            exit 1
          fi

          docker run --rm \
            --network "$CI_NETWORK" \
            -e BASE_URL="http://$APP_CONTAINER:3000" \
            -e SELENIUM_REMOTE_URL="http://$SELENIUM_CONTAINER:4444/wd/hub" \
            "$TEST_IMAGE:$BUILD_NUMBER" npm run test:selenium
        '''
      }
    }

    stage('Deploy to Kubernetes') {
      when {
        expression {
          return sh(
            script: 'kubectl version --request-timeout=5s >/dev/null 2>&1',
            returnStatus: true
          ) == 0
        }
      }
      steps {
        sh '''
          set -eu

          # Docker Desktop's built-in Kubernetes is kind-based. Its containerd
          # image store is separate from the host Docker image store, so a
          # freshly built image is not automatically visible to the pod.
          # When the control-plane container is visible, import the build tag.
          K8S_NODE=$(docker ps --format '{{.Names}} {{.Image}}' \
            | grep -E 'desktop-control-plane|k8s-control-plane|kind-control-plane|kindest/node' \
            | head -n 1 | awk '{print $1}' || true)

          if [ -n "$K8S_NODE" ]; then
            echo "Importing $APP_IMAGE:$BUILD_NUMBER into $K8S_NODE"
            docker save "$APP_IMAGE:$BUILD_NUMBER" -o /tmp/attendance-image.tar
            docker cp /tmp/attendance-image.tar "$K8S_NODE:/tmp/attendance-image.tar"
            docker exec "$K8S_NODE" ctr -n k8s.io images import /tmp/attendance-image.tar
            docker exec "$K8S_NODE" ctr -n k8s.io images tag \
              "docker.io/library/$APP_IMAGE:$BUILD_NUMBER" \
              "docker.io/library/$APP_IMAGE:latest" >/dev/null 2>&1 || true
            rm -f /tmp/attendance-image.tar
          else
            echo "No local kind control-plane container found; assuming the image is reachable from the cluster."
          fi

          kubectl apply -k k8s/
          kubectl -n student-attendance set image deployment/attendance-app \
            attendance-app="$APP_IMAGE:$BUILD_NUMBER"
          kubectl -n student-attendance rollout status deployment/attendance-app --timeout=180s
          kubectl -n student-attendance get pods,svc
        '''
      }
    }
  }

  post {
    success {
      echo 'Pipeline finished successfully. Application image and Selenium suite are green.'
    }
    failure {
      echo 'Pipeline failed. Check the stage logs above for the failing command.'
    }
    always {
      cleanWs()
    }
  }
}
