FROM nginx:alpine

COPY index.html contents.html library.html styles.css app.js contents.js library.js /usr/share/nginx/html/
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template

EXPOSE 80