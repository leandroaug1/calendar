/**
 * SAP ERP - BI Dashboard & Assistant
 * Backend: Versão Corrigida - com suporte a criação de eventos pelo chat
 */

function doGet(e) {
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('SAP ERP - BI Dashboard')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function responder(ok, data, err) {
  return { success: !!ok, data: ok ? data : null, error: ok ? null : (err ? String(err) : 'Erro desconhecido') };
}

function normalizarTexto(s) {
  try {
    return (s || '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  } catch (_) { return (s || '').toString().toLowerCase().trim(); }
}

function aplicarFiltroDatas(padraoInicio, padraoFim, dataFiltro) {
  let ini = new Date(padraoInicio);
  let fim = new Date(padraoFim);
  if (dataFiltro && typeof dataFiltro === 'string') {
    const d = new Date(dataFiltro + 'T00:00:00');
    if (!isNaN(d.getTime())) {
      ini = new Date(d.setHours(0,0,0,0));
      fim = new Date(d.setHours(23,59,59,999));
    }
  }
  return { ini, fim };
}

function formatarParaObjeto(evt, nomeCal, tz, idCalOriginal) {
  const start = evt.getStartTime();
  const end = evt.getEndTime();
  // CORREÇÃO: lê label de ambos os tags para garantir compatibilidade
  const labelTag = (evt.getTag && (evt.getTag('mapa_label') || evt.getTag('label_backup'))) || '';
  return {
    idOriginal: evt.getId(),
    agendaId: idCalOriginal,
    title: evt.getTitle() || "(Sem Título)",
    label: labelTag || "Sem Label",
    description: evt.getDescription() || "",
    start: Utilities.formatDate(start, tz, "yyyy-MM-dd'T'HH:mm:ss"),
    end: Utilities.formatDate(end, tz, "yyyy-MM-dd'T'HH:mm:ss"),
    dataISO: Utilities.formatDate(start, tz, "yyyy-MM-dd"),
    horaInicio: Utilities.formatDate(start, tz, "HH:mm"),
    horaFim: Utilities.formatDate(end, tz, "HH:mm"),
    dataPtBr: Utilities.formatDate(start, tz, "dd/MM/yyyy"),
    timestamp: start.getTime(),
    calendarName: nomeCal,
    allDay: evt.isAllDayEvent()
  };
}

function buscarEventosSap(query) {
  try {
    const tz = Session.getScriptTimeZone();
    const ini = new Date(2000, 0, 1);
    const fim = new Date(2100, 11, 31);
    const termoBusca = query.toString().trim();
    const termoNorm = normalizarTexto(termoBusca);
    const cals = CalendarApp.getAllCalendars();
    let resultados = [];

    cals.forEach(cal => {
      if (cal.isSelected() || cal.isOwnedByMe()) {
        cal.getEvents(ini, fim).forEach(evt => {
          const obj = formatarParaObjeto(evt, cal.getName(), tz, cal.getId());
          const matchData      = obj.dataPtBr === termoBusca;
          const matchTitulo    = normalizarTexto(obj.title).includes(termoNorm);
          const matchLabel     = normalizarTexto(obj.label).includes(termoNorm);
          const matchAgenda    = normalizarTexto(obj.calendarName).includes(termoNorm);
          const matchDescricao = normalizarTexto(obj.description).includes(termoNorm);
          if (matchData || matchTitulo || matchLabel || matchAgenda || matchDescricao) {
            resultados.push(obj);
          }
        });
      }
    });
    return responder(true, resultados.sort((a,b)=>a.timestamp-b.timestamp), null);
  } catch (e) { return responder(false, null, e); }
}

function listarEventosHojeSap() {
  try {
    const tz = Session.getScriptTimeZone();
    const hoje = new Date();
    const cals = CalendarApp.getAllCalendars();
    let evs = [];
    cals.forEach(cal => {
      if (cal.isSelected() || cal.isOwnedByMe()) {
        cal.getEventsForDay(hoje).forEach(evt => evs.push(formatarParaObjeto(evt, cal.getName(), tz, cal.getId())));
      }
    });
    return responder(true, evs.sort((a,b)=>a.timestamp-b.timestamp), null);
  } catch (e) { return responder(false, null, e); }
}

function obterDadosIndicadoresSap(tipoFiltro) {
  try {
    const res = getDadosCompletos(null, null);
    const eventos = res.data.eventosCalendario;
    const contagem = {};
    eventos.forEach(ev => {
      let chave = (tipoFiltro === 'data') ? ev.dataPtBr : (tipoFiltro === 'label' ? ev.label : ev.calendarName);
      contagem[chave] = (contagem[chave] || 0) + 1;
    });
    const labels = Object.keys(contagem);
    if(tipoFiltro === 'data') labels.sort((a,b) => a.split('/').reverse().join('').localeCompare(b.split('/').reverse().join('')));
    return responder(true, { labels: labels, valores: labels.map(l => contagem[l]) }, null);
  } catch (e) { return responder(false, null, e); }
}

function verificarDisponibilidadeSap() {
  try {
    const hoje = new Date();
    const cals = CalendarApp.getAllCalendars();
    let ocupado = [];
    cals.forEach(cal => {
      if (cal.isSelected() || cal.isOwnedByMe()) {
        cal.getEventsForDay(hoje).forEach(e => { if(!e.isAllDayEvent()) ocupado.push({ s: e.getStartTime().getHours(), e: e.getEndTime().getHours() }); });
      }
    });
    let livres = [];
    for(let h=8; h<18; h++) { if(!ocupado.some(o => h >= o.s && h < o.e)) livres.push(h + ":00"); }
    return responder(true, livres, null);
  } catch (e) { return responder(false, null, e); }
}

function getDadosCompletos(dataFiltro, agendaFiltroId) {
  try {
    const tz = Session.getScriptTimeZone();
    const { ini, fim } = aplicarFiltroDatas(
      new Date(new Date().setMonth(new Date().getMonth()-1)),
      new Date(new Date().setMonth(new Date().getMonth()+1)),
      dataFiltro
    );
    const cals = CalendarApp.getAllCalendars();
    let eventos = [], agendas = [], hrsT=0, hrsL=0, hrsS=0;

    cals.forEach(cal => {
      if (cal.isSelected() || cal.isOwnedByMe()) {
        const id = cal.getId();
        agendas.push({ nome: cal.getName(), id: id });
        if (agendaFiltroId && agendaFiltroId !== id) return;
        cal.getEvents(ini, fim).forEach(evt => {
          const obj = formatarParaObjeto(evt, cal.getName(), tz, id);
          const dur = (evt.getEndTime() - evt.getStartTime())/(3600000);
          const t = normalizarTexto(obj.title);
          if(t.includes('sono')) hrsS+=dur;
          else if(t.includes('lazer')) hrsL+=dur;
          else hrsT+=dur;
          eventos.push(obj);
        });
      }
    });

    return responder(true, {
      usuario: Session.getActiveUser().getEmail(),
      eventosCalendario: eventos,
      eventosDashboard: eventos,
      agendas: agendas,
      analise888: {
        trabalho: hrsT.toFixed(1),
        lazer: hrsL.toFixed(1),
        sono: hrsS.toFixed(1),
        livre: Math.max(0, 24-(hrsT+hrsL+hrsS)).toFixed(1)
      }
    }, null);
  } catch (e) { return responder(false, null, e); }
}

function salvarEvento(d) {
  try {
    let cal;
    if (d.agendaId) {
      try { cal = CalendarApp.getCalendarById(d.agendaId); } catch(e) {}
    }
    if (!cal) cal = CalendarApp.getDefaultCalendar();
    if (!cal) return responder(false, null, 'Nenhuma agenda disponivel');

    let evt;
    const dataStr = d.data || new Date().toISOString().slice(0,10);
    const ini = new Date(dataStr + 'T' + (d.horaInicio || '00:00') + ':00');
    const fim = d.allDay
      ? new Date(ini.getTime() + 86399000)
      : new Date(dataStr + 'T' + (d.horaFim || '23:59') + ':00');

    if (d.idOriginal) {
      try { evt = cal.getEventById(d.idOriginal); } catch(e) {}
      if (!evt) {
        const todas = CalendarApp.getAllCalendars();
        for (let i = 0; i < todas.length && !evt; i++) {
          try { evt = todas[i].getEventById(d.idOriginal); } catch(e) {}
        }
      }
      if (evt) { try { evt.setTime(ini, fim); } catch(e) {} }
    }

    if (!evt) {
      evt = d.allDay
        ? cal.createAllDayEvent(d.titulo || 'ATA', ini)
        : cal.createEvent(d.titulo || 'Evento', ini, fim);
    }

    evt.setTitle(d.titulo || 'Evento');
    evt.setDescription(d.descricao || '');
    if (evt.setTag) { try { evt.setTag('mapa_label', d.label || ''); } catch(e) {} }

    return responder(true, { id: evt.getId(), idOriginal: evt.getId() }, null);
  } catch (e) {
    return responder(false, null, e);
  }
}

function excluirEvento(agId, evId) {
  try {
    const cal = CalendarApp.getCalendarById(agId);
    const evt = cal.getEventById(evId);
    if(evt) evt.deleteEvent();
    return responder(true, true, null);
  } catch (e) { return responder(false, null, e); }
}

/**
 * Criar evento rápido via chat (sem formulário)
 */
function criarEventoRapidoChat(d) {
  try {
    const cal = d.agendaId
      ? CalendarApp.getCalendarById(d.agendaId)
      : CalendarApp.getDefaultCalendar();

    if (!cal) return responder(false, null, 'Agenda não encontrada');

    const ini = new Date(d.data + 'T' + (d.horaInicio || '09:00'));
    const fim = new Date(d.data + 'T' + (d.horaFim || '10:00'));

    const evt = cal.createEvent(d.titulo, ini, fim);
    evt.setDescription(d.descricao || '');
    if (evt.setTag) {
      evt.setTag('mapa_label', d.label || '');
      evt.setTag('label_backup', d.label || '');
    }

    const tz = Session.getScriptTimeZone();
    const obj = formatarParaObjeto(evt, cal.getName(), tz, cal.getId());

    return responder(true, obj, null);
  } catch (e) { return responder(false, null, e); }
}

/**
 * Atualiza apenas o label de um evento (usado pelo Kaizen Revisado)
 */
function atualizarLabelEvento(agendaId, evId, novoLabel) {
  try {
    const cal = CalendarApp.getCalendarById(agendaId);
    if (!cal) return responder(false, null, 'Agenda não encontrada');
    const evt = cal.getEventById(evId);
    if (!evt) return responder(false, null, 'Evento não encontrado');
    if (evt.setTag) {
      evt.setTag('mapa_label', novoLabel || '');
      evt.setTag('label_backup', novoLabel || '');
    }
    return responder(true, { label: novoLabel }, null);
  } catch(e) { return responder(false, null, e); }
}

/**
 * Faz upload de um arquivo (base64) para o Google Drive
 * e retorna o fileId, link de visualização e metadados.
 * Os arquivos ficam numa pasta "SAP-Anexos-Eventos" no Drive raiz.
 */
function uploadAnexoEvento(base64Data, fileName, mimeType) {
  try {
    const PASTA_NOME = 'SAP-Anexos-Eventos';
    // Localizar ou criar pasta
    let pasta;
    const pastas = DriveApp.getFoldersByName(PASTA_NOME);
    if (pastas.hasNext()) {
      pasta = pastas.next();
    } else {
      pasta = DriveApp.createFolder(PASTA_NOME);
    }
    // Decodificar base64 e criar arquivo
    const blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType, fileName);
    const file = pasta.createFile(blob);
    // Tornar visualizável por qualquer pessoa com o link
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    const fileId = file.getId();
    return responder(true, {
      fileId:   fileId,
      fileName: fileName,
      mimeType: mimeType,
      size:     file.getSize(),
      viewUrl:  'https://drive.google.com/file/d/' + fileId + '/view',
      thumbUrl: 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w80-h80'
    }, null);
  } catch (e) { return responder(false, null, e); }
}

/**
 * Remove um arquivo do Drive pelo fileId
 */
function removerAnexoEvento(fileId) {
  try {
    const file = DriveApp.getFileById(fileId);
    file.setTrashed(true);
    return responder(true, true, null);
  } catch (e) { return responder(false, null, e); }
}

/**
 * Retorna metadados de múltiplos arquivos pelo fileId
 * Usado ao reabrir um evento para recarregar os chips de anexo
 */
function listarAnexosEvento(fileIds) {
  try {
    const lista = [];
    (fileIds || []).forEach(function(id) {
      try {
        const file = DriveApp.getFileById(id);
        lista.push({
          fileId:   id,
          fileName: file.getName(),
          mimeType: file.getMimeType(),
          size:     file.getSize(),
          viewUrl:  'https://drive.google.com/file/d/' + id + '/view',
          thumbUrl: 'https://drive.google.com/thumbnail?id=' + id + '&sz=w80-h80'
        });
      } catch (_) {
        // Arquivo pode ter sido removido — ignorar
      }
    });
    return responder(true, lista, null);
  } catch (e) { return responder(false, null, e); }
}

/**
 * Retorna lista de agendas disponíveis
 */
function listarAgendasDisponiveis() {
  try {
    const cals = CalendarApp.getAllCalendars();
    const agendas = [];
    cals.forEach(cal => {
      if (cal.isSelected() || cal.isOwnedByMe()) {
        agendas.push({ id: cal.getId(), nome: cal.getName() });
      }
    });
    return responder(true, agendas, null);
  } catch(e) { return responder(false, null, e); }
}

/**
 * Busca TODOS os eventos de todas as agendas sem restrição de data
 * Usado exclusivamente pela aba Calendário para exibir 100% dos eventos
 */
function getDadosCalendarioCompleto() {
  try {
    const tz = Session.getScriptTimeZone();
    // Range amplo: 5 anos atrás até 5 anos à frente
    const ini = new Date(new Date().getFullYear() - 5, 0, 1);
    const fim = new Date(new Date().getFullYear() + 5, 11, 31);

    const cals = CalendarApp.getAllCalendars();
    let eventos = [], agendas = [];

    cals.forEach(cal => {
      if (cal.isSelected() || cal.isOwnedByMe()) {
        const id = cal.getId();
        agendas.push({ nome: cal.getName(), id: id });
        cal.getEvents(ini, fim).forEach(evt => {
          eventos.push(formatarParaObjeto(evt, cal.getName(), tz, id));
        });
      }
    });

    return responder(true, {
      usuario: Session.getActiveUser().getEmail(),
      eventosCalendario: eventos,
      eventosDashboard: eventos,
      agendas: agendas
    }, null);
  } catch (e) { return responder(false, null, e); }
}

/**
 * Calcula tempos de trajeto reais via Google Maps Distance Matrix API
 * Chamado pelo frontend ao renderizar o Maps Navigator
 * 
 * @param {Array} segmentos - [{origem: string, destino: string, horaISO: string}]
 * @returns {Array} [{duracaoMin: number, distanciaKm: number, status: string}]
 */
function calcularTrajetos(segmentos) {
  try {
    // Chave da API — inserir em Script Properties para segurança
    const props = PropertiesService.getScriptProperties();
    const apiKey = props.getProperty('GOOGLE_MAPS_KEY') || '';

    if (!apiKey) {
      // Sem chave: retornar estimativas baseadas em geocoding gratuito do Maps
      // Usar Maps.newDirectionFinder() que é gratuito no Apps Script
      return responder(true, segmentos.map(function(seg) {
        try {
          const finder = Maps.newDirectionFinder()
            .setOrigin(seg.origem)
            .setDestination(seg.destino)
            .setMode(Maps.DirectionFinder.Mode.DRIVING)
            .setDepartureTime(seg.horaISO ? new Date(seg.horaISO) : new Date());
          const result = finder.getDirections();
          if (result && result.routes && result.routes.length > 0) {
            const leg = result.routes[0].legs[0];
            const duracaoSeg = leg.duration_in_traffic
              ? leg.duration_in_traffic.value
              : leg.duration.value;
            const distanciaM = leg.distance.value;
            return {
              duracaoMin: Math.ceil(duracaoSeg / 60),
              distanciaKm: (distanciaM / 1000).toFixed(1),
              resumo: leg.duration_in_traffic
                ? leg.duration_in_traffic.text + ' (c/ trânsito)'
                : leg.duration.text,
              status: 'ok'
            };
          }
          return { duracaoMin: null, distanciaKm: null, status: 'sem_rota' };
        } catch (segErr) {
          return { duracaoMin: null, distanciaKm: null, status: 'erro', erro: String(segErr) };
        }
      }), null);
    }

    // Com chave: usar Distance Matrix API para todos de uma vez
    const origens = segmentos.map(s => encodeURIComponent(s.origem)).join('|');
    const destinos = segmentos.map(s => encodeURIComponent(s.destino)).join('|');
    const agora = Math.floor(Date.now() / 1000);
    const url = 'https://maps.googleapis.com/maps/api/distancematrix/json' +
      '?origins=' + origens +
      '&destinations=' + destinos +
      '&mode=driving' +
      '&departure_time=' + agora +
      '&traffic_model=best_guess' +
      '&language=pt-BR' +
      '&key=' + apiKey;

    const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const json = JSON.parse(resp.getContentText());

    const resultados = segmentos.map(function(seg, idx) {
      try {
        const row = json.rows[idx];
        const el = row && row.elements && row.elements[idx];
        if (!el || el.status !== 'OK') return { duracaoMin: null, distanciaKm: null, status: el ? el.status : 'erro' };
        const dur = el.duration_in_traffic ? el.duration_in_traffic.value : el.duration.value;
        return {
          duracaoMin: Math.ceil(dur / 60),
          distanciaKm: (el.distance.value / 1000).toFixed(1),
          resumo: el.duration_in_traffic
            ? el.duration_in_traffic.text + ' (c/ trânsito)'
            : el.duration.text,
          status: 'ok'
        };
      } catch (e2) {
        return { duracaoMin: null, distanciaKm: null, status: 'erro' };
      }
    });

    return responder(true, resultados, null);
  } catch (e) {
    return responder(false, null, e);
  }
}

/**
 * Upload de arquivo em chunks para suportar vídeos grandes.
 * Cada chunk é base64. No último chunk, os chunks são concatenados e o arquivo é criado.
 * Os chunks intermediários são salvos em PropertiesService (ScriptProperties) temporariamente.
 */
/**
 * Upload de arquivo em chunks usando o Drive como armazenamento temporário.
 * Cada chunk é salvo como arquivo separado no Drive.
 * No último chunk, os arquivos são lidos, concatenados e o arquivo final é criado.
 * PropertiesService só guarda os IDs dos arquivos temporários (pequeno).
 */
function uploadAnexoChunk(base64Data, fileName, mimeType, chunkIdx, totalChunks, uploadId) {
  try {
    const PASTA_NOME = 'SAP-Anexos-Eventos';
    let pasta;
    const pastas = DriveApp.getFoldersByName(PASTA_NOME);
    pasta = pastas.hasNext() ? pastas.next() : DriveApp.createFolder(PASTA_NOME);

    // Salva chunk como arquivo temporário no Drive
    const chunkBlob = Utilities.newBlob(Utilities.base64Decode(base64Data), 'application/octet-stream', 'tmp_' + uploadId + '_' + chunkIdx);
    const chunkFile = pasta.createFile(chunkBlob);
    const props = PropertiesService.getScriptProperties();
    props.setProperty('CHUNKID_' + uploadId + '_' + chunkIdx, chunkFile.getId());

    if (chunkIdx < totalChunks - 1) {
      return responder(true, { status: 'chunk_ok', chunkIdx: chunkIdx }, null);
    }

    // Último chunk — concatena todos os bytes
    let bytes = [];
    for (let i = 0; i < totalChunks; i++) {
      const fid = props.getProperty('CHUNKID_' + uploadId + '_' + i);
      if (!fid) throw new Error('Chunk ' + i + ' não encontrado');
      const f = DriveApp.getFileById(fid);
      const b = f.getBlob().getBytes();
      bytes = bytes.concat(b);
      f.setTrashed(true); // remove temporário
      props.deleteProperty('CHUNKID_' + uploadId + '_' + i);
    }

    // Cria arquivo final
    const finalBlob = Utilities.newBlob(bytes, mimeType, fileName);
    const file = pasta.createFile(finalBlob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    return responder(true, {
      fileId:   file.getId(),
      fileName: fileName,
      mimeType: mimeType,
      size:     file.getSize(),
      viewUrl:  'https://drive.google.com/file/d/' + file.getId() + '/view'
    }, null);

  } catch (e) {
    // Limpa arquivos temporários em caso de erro
    try {
      const props = PropertiesService.getScriptProperties();
      for (let i = 0; i < totalChunks; i++) {
        const fid = props.getProperty('CHUNKID_' + uploadId + '_' + i);
        if (fid) { try { DriveApp.getFileById(fid).setTrashed(true); } catch(e3) {} }
        props.deleteProperty('CHUNKID_' + uploadId + '_' + i);
      }
    } catch(e2) {}
    return responder(false, null, e);
  }
}

/**
 * Salva o JSON de dados da ATA como arquivo no Drive (sem limite de tamanho).
 * Retorna o fileId para guardar na descrição do evento do Calendar.
 */
function salvarDadosATA(jsonString) {
  try {
    const PASTA_NOME = 'SAP-Dados-ATA';
    let pasta;
    const pastas = DriveApp.getFoldersByName(PASTA_NOME);
    pasta = pastas.hasNext() ? pastas.next() : DriveApp.createFolder(PASTA_NOME);

    // Apaga versão anterior e cria nova (setContent não existe no Apps Script)
    const arquivos = pasta.getFilesByName('ata-dados.json');
    while (arquivos.hasNext()) {
      arquivos.next().setTrashed(true);
    }

    const blob = Utilities.newBlob(jsonString, 'application/json', 'ata-dados.json');
    const file = pasta.createFile(blob);
    // Mantém privado — apenas o owner pode ler
    file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);

    return responder(true, { fileId: file.getId(), fileName: 'ata-dados.json' }, null);
  } catch (e) {
    return responder(false, null, e);
  }
}

/**
 * Lê o conteúdo de um arquivo do Drive pelo ID.
 */
function lerArquivoDrive(fileId) {
  try {
    const file = DriveApp.getFileById(fileId);
    const conteudo = file.getBlob().getDataAsString('UTF-8');
    return responder(true, { conteudo: conteudo }, null);
  } catch (e) {
    return responder(false, null, e);
  }
}

/**
 * Busca imagem do Drive e retorna como base64 para uso no canvas do frontend.
 */
function buscarImagemBase64(fileId) {
  try {
    const file = DriveApp.getFileById(fileId);
    const blob = file.getBlob();
    const base64 = Utilities.base64Encode(blob.getBytes());
    const mimeType = blob.getContentType() || 'image/jpeg';
    return responder(true, { base64: base64, mimeType: mimeType }, null);
  } catch (e) {
    return responder(false, null, e);
  }
}
