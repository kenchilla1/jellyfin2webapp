FROM nginx:alpine

ENV JELLYFIN_SERVER=http://192.168.1.155:6961 \
	NGINX_ENVSUBST_FILTER=^JELLYFIN_SERVER$

COPY index.html contents.html library.html styles.css app.js contents.js library.js /usr/share/nginx/html/
COPY App_icon.png /usr/share/nginx/html/App_icon.png
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template

EXPOSE 80