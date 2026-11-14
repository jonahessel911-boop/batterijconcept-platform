-- Installatievideo in project-fotos: ruimere limiet (tot ~80 MB voor 30–60s HD).
update storage.buckets
set file_size_limit = 83886080
where id = 'project-fotos';
