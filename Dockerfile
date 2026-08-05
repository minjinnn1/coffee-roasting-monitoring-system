FROM nginx:1.27-alpine

WORKDIR /usr/share/nginx/html

# Static frontend only
COPY assets ./assets
COPY *.html .

EXPOSE 80

HEALTHCHECK CMD wget -qO- http://localhost/ || exit 1
