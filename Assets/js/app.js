let db;
const dbName = "TurniLavoroDB";
const dbVersion = 3;
let impostazioniCorrenti = {
  oreSettimanali: 24,
  pagaOraria: 6.79386,
  percentualeTasse: 0,
  fasciaNotteInizio: "00:00",
  fasciaNotteFine: "06:00",
  extraNotturno: 25,
  extraDomenicale: 10,
  extraFestivo: 120,
};

let settimanaCorrente = 0; // Spostato qui in alto! ✅




const request = indexedDB.open(dbName, dbVersion);

request.onupgradeneeded = function (event) {
  db = event.target.result;
  console.log("Aggiornamento del database necessario. Versione:", db.version);

  if (!db.objectStoreNames.contains("turni")) {
    const turniStore = db.createObjectStore("turni", { keyPath: "id", autoIncrement: true });
    turniStore.createIndex("data", "data", { unique: false });
  }

  if (!db.objectStoreNames.contains("impostazioni")) {
    db.createObjectStore("impostazioni");
  }

  if (!db.objectStoreNames.contains("stipendi")) {
    db.createObjectStore("stipendi");
  }

  // ✅ Aggiungi questo blocco:
  if (!db.objectStoreNames.contains("malattie")) {
    db.createObjectStore("malattie", { keyPath: "id", autoIncrement: true });
  }
};


request.onerror = function (event) {
  console.error("Errore nell'aprire IndexedDB", event);
};

request.onsuccess = function (event) {
  db = event.target.result;
  console.log("IndexedDB aperto con successo:", db);
  loadTurni();
  caricaImpostazioniNelForm();
  controllaTurnoOggi();
  generaListaStipendi();
  getMalattie().then(m => {
    window.listaMalattie = m;
    generaListaStipendi(); // solo qui
  });
  





};


window.onload = () => {
  populateFilters();
  document.getElementById("filtro-mese").addEventListener("change", () => {
    settimanaCorrente = 0;
    loadTurni();
  });
  document.getElementById("filtro-anno").addEventListener("change", () => {
    settimanaCorrente = 0;
    loadTurni();
  });
  document.getElementById("filtro-anno-stipendi").addEventListener("change", generaListaStipendi);
  setupForm();
  setupImpostazioniForm();
  setupNavigation();
};





function setupNavigation() {
  console.log("Impostazione della navigazione...");
  document.querySelectorAll("nav button").forEach(button => {
    button.addEventListener("click", () => {
      document.querySelectorAll("nav button").forEach(b => b.classList.remove("active"));
      button.classList.add("active");
      document.querySelectorAll("main").forEach(view => view.style.display = "none");

      const viewId = button.getAttribute("data-view");
      const view = document.getElementById(viewId);
      if (view) view.style.display = "block";

      // 🔁 Ricarica la lista stipendi solo quando si entra nella sezione "stipendi"
      if (viewId === "stipendi-view") {
        generaListaStipendi();
        console.log("lista stipendi aggiornata");
      }
    });
  });
}


function toMinuti(str) {
  const [h, m] = str.split(":").map(Number);
  return h * 60 + m;
}

function calcolaOre(inizio, fine, pausaMin) {
  const [hi, mi] = inizio.split(":"), [hf, mf] = fine.split(":");
  let ore = (parseInt(hf) + parseInt(mf) / 60) - (parseInt(hi) + parseInt(mi) / 60);
  if (ore < 0) ore += 24;
  return ore - pausaMin / 60;
}
function calcolaOreNotturne(inizio, fine, fasciaInizio, fasciaFine) {
  const toMinuti = (str) => {
    const [h, m] = str.split(":").map(Number);
    return h * 60 + m;
  };

  const inizioTurno = toMinuti(inizio);
  const fineTurno = toMinuti(fine);
  const notteInizio = toMinuti(fasciaInizio);
  const notteFine = toMinuti(fasciaFine);

  let minutiNotte = 0;

  // Gestione turni che passano la mezzanotte
  const intervalloTurno = fineTurno > inizioTurno ? [inizioTurno, fineTurno] : [inizioTurno, fineTurno + 1440];
  const intervalloNotte = notteFine > notteInizio
    ? [notteInizio, notteFine]
    : [notteInizio, notteFine + 1440];

  for (let m = intervalloTurno[0]; m < intervalloTurno[1]; m++) {
    const minuto = m % 1440;
    if (minuto >= intervalloNotte[0] % 1440 && minuto < intervalloNotte[1] % 1440) {
      minutiNotte++;
    }
  }

  return minutiNotte / 60;
}

function eliminaTurno(id) {
  console.log("Eliminazione del turno con ID:", id);
  if (!confirm("Vuoi eliminare questo turno?")) return;
  const tx = db.transaction("turni", "readwrite");
  tx.objectStore("turni").delete(id);
  tx.oncomplete = () => {
    loadTurni();
    controllaTurnoOggi();
    generaListaStipendi();
  };
}

function modificaTurno(id) {
  console.log("Modifica del turno con ID:", id);
  const tx = db.transaction("turni", "readonly");
  const req = tx.objectStore("turni").get(id);

  req.onsuccess = () => {
    console.log("Risultato della richiesta get:", req.result);
    const turno = req.result;

    if (!turno) {
      alert("Turno non trovato (potrebbe essere stato eliminato).");
      return;
    }

    const form = document.getElementById("turno-form");
    form.querySelector('[name="id"]').value = id;
    form.querySelector('[name="data"]').value = turno.data;
    form.querySelector('[name="oraInizio"]').value = turno.oraInizio;
    form.querySelector('[name="oraFine"]').value = turno.oraFine;
    form.querySelector('[name="pausa"]').value = turno.pausa;
    form.querySelector('[name="festivo"]').checked = turno.festivo;
  };
}



function setupForm() {
  const form = document.getElementById("turno-form");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    console.log("Form inviato");

    const idField = form.querySelector('[name="id"]');
    const id = idField.value;

    const turno = {
      data: form.querySelector('[name="data"]').value,
      oraInizio: form.querySelector('[name="oraInizio"]').value,
      oraFine: form.querySelector('[name="oraFine"]').value,
      pausa: parseInt(form.querySelector('[name="pausa"]').value, 10),
      festivo: form.querySelector('[name="festivo"]').checked,
    };

    const tx = db.transaction("turni", "readwrite");
    const store = tx.objectStore("turni");

    const req = id ? store.put({ ...turno, id: parseInt(id) }) : store.add(turno);

    req.onsuccess = () => {
      form.reset();
      idField.value = "";
      loadTurni();
      controllaTurnoOggi();
      generaListaStipendi();
    };
  });
}



function controllaTurnoOggi() {
  console.log("Controllo del turno di oggi...");
  const oggi = new Date().toISOString().split("T")[0];
  const box = document.getElementById("turno-oggi");

  const tx = db.transaction("turni", "readonly");
  const store = tx.objectStore("turni");
  const request = store.openCursor();

  let trovato = false;

  request.onsuccess = (event) => {
    const cursor = event.target.result;
    if (cursor) {
      const turno = cursor.value;
      if (turno.data === oggi) {
        trovato = true;
        box.innerHTML = `<strong>Turno di oggi:</strong><br/>${turno.oraInizio} - ${turno.oraFine}<br/>Pausa: ${turno.pausa} min`;
      } else {
        cursor.continue();
      }
    }
    if (!cursor && !trovato) {
      box.textContent = "Oggi sei di riposo.";
    }
  };
}

function caricaImpostazioniNelForm() {
  const tx = db.transaction("impostazioni", "readonly");
  const store = tx.objectStore("impostazioni");
  const req = store.get("config");

  req.onsuccess = () => {
    const imp = req.result;
    const form = document.getElementById("impostazioni-form");

    if (imp) {
      impostazioniCorrenti = { ...impostazioniCorrenti, ...imp };

      for (const key in imp) {
        const el = form.elements[key];
        if (!el) continue;

        if (el.type === "checkbox") {
          el.checked = Boolean(imp[key]); // ✅ forza valore booleano
        } else {
          el.value = imp[key];
        }
      }
    }
  };
}


function setupImpostazioniForm() {
  console.log("Caricamento delle impostazioni nel form...");
  const form = document.getElementById("impostazioni-form");

  form.addEventListener("submit", (e) => {
    e.preventDefault();

    const impostazioni = {};
    for (const el of form.elements) {
      if (!el.name) continue;

      if (el.type === "checkbox") {
        impostazioni[el.name] = el.checked; // ✅ salvataggio booleano vero/falso
      } else if (el.type === "number") {
        impostazioni[el.name] = parseFloat(el.value);
      } else {
        impostazioni[el.name] = el.value;
      }
    }

    impostazioniCorrenti = impostazioni;

    const tx = db.transaction("impostazioni", "readwrite");
    tx.objectStore("impostazioni").put(impostazioni, "config");

    tx.oncomplete = () => {
      caricaImpostazioniNelForm();
      loadTurni();
      controllaTurnoOggi();
      generaListaStipendi();
    };
  });
}


function populateFilters() {
  const meseSel = document.getElementById("filtro-mese");
  const annoSel1 = document.getElementById("filtro-anno");
  const annoSel2 = document.getElementById("filtro-anno-stipendi");
  const annoCorrente = new Date().getFullYear();

  // ✅ Popola il filtro mese
  const mesi = [
    "Tutti", "Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio",
    "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"
  ];

  mesi.forEach((nome, i) => {
    const opt = document.createElement("option");
    opt.value = i; // 0 = Tutti, 1 = Gennaio, ecc.
    opt.textContent = nome;
    meseSel.appendChild(opt);
  });

  // ✅ Popola i filtri anno
  for (let i = annoCorrente - 5; i <= annoCorrente + 1; i++) {
    [annoSel1, annoSel2].forEach(sel => {
      const opt = document.createElement("option");
      opt.value = i;
      opt.textContent = i;
      if (i === annoCorrente) opt.selected = true;
      sel.appendChild(opt);
    });
  }
}


function generaListaStipendi() {
  console.log("Generazione della lista stipendi...");
  const contenitore = document.getElementById("lista-stipendi");
  const anno = parseInt(document.getElementById("filtro-anno-stipendi").value);
  contenitore.innerHTML = "";
  const datiMensili = Array.from({ length: 12 }, (_, i) => ({ mese: i + 1, ore: 0, lordo: 0 }));

  const tx = db.transaction("turni", "readonly");
  const store = tx.objectStore("turni");
  const req = store.openCursor();

  req.onsuccess = (event) => {
    const cursor = event.target.result;
    if (cursor) {
      const t = cursor.value;
      const data = new Date(t.data);
      const mese = data.getMonth();
      const annoTurno = data.getFullYear();
      if (annoTurno === anno) {
        const ore = calcolaOre(t.oraInizio, t.oraFine, t.pausa);
        let guadagnoBase = ore * impostazioniCorrenti.pagaOraria;
        let maggiorazione = 0;

        const giornoSettimana = data.getDay();

        if (t.festivo) maggiorazione += guadagnoBase * (impostazioniCorrenti.extraFestivo / 100);
        if (giornoSettimana === 0) maggiorazione += guadagnoBase * (impostazioniCorrenti.extraDomenicale / 100);

        const oreNotturne = calcolaOreNotturne(
          t.oraInizio, t.oraFine,
          impostazioniCorrenti.fasciaNotteInizio,
          impostazioniCorrenti.fasciaNotteFine
        );
        if (oreNotturne > 0) {
          const notturnoBase = oreNotturne * impostazioniCorrenti.pagaOraria;
          maggiorazione += notturnoBase * (impostazioniCorrenti.extraNotturno / 100);
        }

        const guadagnoTotale = guadagnoBase + maggiorazione;

        datiMensili[mese].ore += ore;
        datiMensili[mese].lordo += guadagnoTotale;
      }


      cursor.continue();
    } else {
      const tx2 = db.transaction("stipendi", "readonly");
      const store2 = tx2.objectStore("stipendi");
      datiMensili.forEach((m, i) => {
        if (m.lordo > 0) { // ✅ Mostra solo se c'è stipendio
          const chiave = `${anno}-${i + 1}`;
          const req2 = store2.get(chiave);
          req2.onsuccess = () => {
            const effettivo = req2.result;

            const oreContrattoMese = calcolaOreContrattualiMese(anno, i + 1, impostazioniCorrenti.oreSettimanali);
            const oreMalattia = Math.max(0, oreContrattoMese - m.ore);
            const pagaMalattia = (oreMalattia <= 0) ? 0 : calcolaGuadagnoMalattia(anno, i + 1, oreMalattia);
            m.lordo += pagaMalattia;

            const netto = m.lordo - (m.lordo * (impostazioniCorrenti.percentualeTasse / 100));

            contenitore.innerHTML += `
              <div class="stipendio-box">
                <h4>${new Date(anno, i).toLocaleString('it-IT', { month: 'long', year: 'numeric' })}</h4>
                <p>Ore lavorate: ${m.ore.toFixed(2)}</p>
                <p>Lordo: €${m.lordo.toFixed(2)}</p>
                <p>Netto (stimato): €${netto.toFixed(2)}</p>
                ${effettivo ? `<div class="stipendio-confronto">
                  Netto stimato: <span class="calcolato">€${netto.toFixed(2)}</span><br/>
                  Effettivo: <span class="effettivo">€${effettivo.toFixed(2)}</span><br/>
                  Differenza: <span class="differenza">€${(effettivo - netto).toFixed(2)}</span>
                </div>` : ""}
                <button onclick="apriModaleStipendio('${chiave}', ${m.lordo.toFixed(2)}, ${m.ore.toFixed(2)})">Visualizza/Modifica</button>
              </div>`;
          };
        }
      });

    }


  };
}

function apriModaleStipendio(chiave, lordo, ore) {
  const [anno, mese] = chiave.split("-").map(Number);
  const oreContratto = calcolaOreContrattualiMese(anno, mese, impostazioniCorrenti.oreSettimanali);
  const oreStraordinarie = Math.max(0, ore - oreContratto);
  const guadagnoStraordinari = oreStraordinarie * impostazioniCorrenti.pagaOraria;

  const giorniMalattia = getGiorniMalattiaNelMese(anno, mese);
  const oreMalattia = calcolaOreMalattiaReali(anno, mese);

  const guadagnoMalattia = oreMalattia > 0 ? calcolaGuadagnoMalattia(anno, mese, oreMalattia) : 0;

  const netto = lordo - (lordo * (impostazioniCorrenti.percentualeTasse / 100));

  let html = `
    <p><strong>Mese:</strong> ${new Date(anno, mese - 1).toLocaleString('it-IT', { month: 'long', year: 'numeric' })}</p>
    <p><strong>Ore lavorate:</strong> ${ore.toFixed(2)}</p>
    <p><strong>Guadagno lordo:</strong> €${lordo.toFixed(2)}</p>
    <p><strong>Guadagno netto (stimato):</strong> €${netto.toFixed(2)}</p>
  `;

  if (oreStraordinarie > 0) {
    html += `
      <hr>
      <p><strong>Ore straordinarie:</strong> ${oreStraordinarie.toFixed(2)}</p>
      <p><strong>Guadagno straordinari:</strong> €${guadagnoStraordinari.toFixed(2)}</p>
    `;
  }

  if (oreMalattia > 0) {
    html += `
      <hr>
      <p><strong>Giorni di malattia:</strong> ${giorniMalattia.length}</p>
      <p><strong>Ore di malattia (stimate):</strong> ${oreMalattia.toFixed(2)}</p>
      <p><strong>Guadagno da malattia:</strong> €${guadagnoMalattia.toFixed(2)}</p>
    `;
  }

  document.getElementById("modale-titolo").textContent = `Stipendio di ${chiave}`;
  document.getElementById("modale-dettagli").innerHTML = html;

  const input = document.getElementById("stipendio-effettivo-input");
  input.value = "";
  input.dataset.chiave = chiave;
  input.dataset.lordo = lordo;

  document.getElementById("modale-confronto").innerHTML = "";
  document.getElementById("modale-stipendio").style.display = "flex";
}


function salvaStipendioEffettivo() {
  const input = document.getElementById("stipendio-effettivo-input");
  const chiave = input.dataset.chiave;
  const lordo = parseFloat(input.dataset.lordo);
  const effettivo = parseFloat(input.value);
  const tx = db.transaction("stipendi", "readwrite");
  tx.objectStore("stipendi").put(effettivo, chiave);
  tx.oncomplete = () => {
    chiudiModale();
    generaListaStipendi();
  };
}

function chiudiModale() {
  document.getElementById("modale-stipendio").style.display = "none";
}



document.getElementById("prev-settimana").addEventListener("click", () => {
  settimanaCorrente--;
  loadTurni();
});

document.getElementById("next-settimana").addEventListener("click", () => {
  settimanaCorrente++;
  loadTurni();
});
function getInizioSettimanaOffset(offsetSettimana = 0) {
  const oggi = new Date();
  const giorno = oggi.getDay(); // 0 = Domenica, 1 = Lunedì
  const diffDaLunedi = giorno === 0 ? 6 : giorno - 1;
  const inizioSettimana = new Date(oggi);
  inizioSettimana.setDate(oggi.getDate() - diffDaLunedi + offsetSettimana * 7);
  inizioSettimana.setHours(0, 0, 0, 0);
  return inizioSettimana;
}


function getInizioSettimanaDelFiltro(offsetSettimana) {
  const meseFiltro = parseInt(document.getElementById("filtro-mese").value);
  const annoFiltro = parseInt(document.getElementById("filtro-anno").value);

  // Se non è selezionato nulla, usa oggi
  if (isNaN(meseFiltro) || isNaN(annoFiltro)) {
    const oggi = new Date();
    return getInizioSettimanaOffset(offsetSettimana); // fallback
  }
  
  const primoDelMese = new Date(annoFiltro, meseFiltro - 1, 1);
  const giornoSettimana = primoDelMese.getDay(); // 0 = domenica, 1 = lunedì, ...
  let giornoInizio = primoDelMese.getDate();

  // Trova primo lunedì del mese
  if (giornoSettimana !== 1) {
    giornoInizio += (giornoSettimana === 0 ? 1 : (8 - giornoSettimana));
  }

  const primoLunedi = new Date(annoFiltro, meseFiltro - 1, giornoInizio);
  primoLunedi.setDate(primoLunedi.getDate() + offsetSettimana * 7);
  primoLunedi.setHours(0, 0, 0, 0);
  return primoLunedi;
}

function eliminaGiornoMalattia(id, giornoDaRimuovere) {
  const tx = db.transaction("malattie", "readwrite");
  const store = tx.objectStore("malattie");
  const req = store.get(id);

  req.onsuccess = () => {
    const malattia = req.result;
    if (!malattia) return;

    const inizio = new Date(malattia.inizio);
    const fine = new Date(malattia.fine);
    giornoDaRimuovere.setHours(0, 0, 0, 0);

    // Caso: malattia di un solo giorno
    if (inizio.getTime() === fine.getTime()) {
      store.delete(id);
    }
    // Caso: rimuovi giorno iniziale
    else if (giornoDaRimuovere.getTime() === inizio.getTime()) {
      malattia.inizio = new Date(inizio.getTime() + 86400000).toISOString(); // +1 giorno
      store.put(malattia);
    }
    // Caso: rimuovi giorno finale
    else if (giornoDaRimuovere.getTime() === fine.getTime()) {
      malattia.fine = new Date(fine.getTime() - 86400000).toISOString(); // -1 giorno
      store.put(malattia);
    }
    // Caso: spezza la malattia in due (giorno a metà)
    else {
      const nuovaMalattia = {
        inizio: new Date(giornoDaRimuovere.getTime() + 86400000).toISOString(),
        fine: malattia.fine,
        numeroProtocollo: malattia.numeroProtocollo || null
      };
      malattia.fine = new Date(giornoDaRimuovere.getTime() - 86400000).toISOString();
      store.put(malattia);
      store.add(nuovaMalattia);
    }
  };

  tx.oncomplete = async () => {
    window.listaMalattie = await getMalattie();
    loadTurni();
    generaListaStipendi();
  };
}

function calcolaOreMalattiaReali(anno, mese) {
  const giorni = getGiorniMalattiaNelMese(anno, mese);
  const oreSettimanali = impostazioniCorrenti.oreSettimanali;
  const orePerGiorno = oreSettimanali / 6; // ipotizziamo 6 giorni lavorativi

  if (!giorni.length) return 0;

  // Raggruppa i giorni per settimana ISO
  const settimane = {};

  giorni.forEach(d => {
    const chiaveSettimana = getSettimanaISO(d);
    settimane[chiaveSettimana] = (settimane[chiaveSettimana] || 0) + 1;
  });

  let oreTotali = 0;
  for (const chiave in settimane) {
    const giorniSettimana = settimane[chiave];
    const oreSettimana = Math.min(giorniSettimana * orePerGiorno, oreSettimanali);
    oreTotali += oreSettimana;
  }

  return oreTotali;
}




function loadTurni() {
  console.log("Caricamento dei turni in corso...");
  const lista = document.getElementById("lista-turni");
  lista.innerHTML = ""; // ✅ Pulisce la tabella ogni volta

  const meseFiltro = parseInt(document.getElementById("filtro-mese").value);
  const annoFiltro = parseInt(document.getElementById("filtro-anno").value);

  const tx = db.transaction("turni", "readonly");
  const store = tx.objectStore("turni");
  const index = store.index("data");
  const request = index.openCursor(null, "next");

  let totaleOreMese = 0;
  let totaleGuadagnoMese = 0;
  const righe = [];

  const inizioSettimana = getInizioSettimanaDelFiltro(settimanaCorrente);
  const fineSettimana = new Date(inizioSettimana);
  fineSettimana.setDate(fineSettimana.getDate() + 6);
  fineSettimana.setHours(23, 59, 59, 999);

  const settimanaLabel = `${inizioSettimana.toLocaleDateString()} - ${fineSettimana.toLocaleDateString()}`;
  document.getElementById("etichetta-settimana").textContent = `Settimana: ${settimanaLabel}`;

  request.onsuccess = (event) => {
    const cursor = event.target.result;
    if (cursor) {
      const t = cursor.value;
      const dataObj = new Date(t.data);
      const meseTurno = dataObj.getMonth() + 1;
      const annoTurno = dataObj.getFullYear();
      const giornoSettimana = dataObj.getDay();

      const passaFiltroMese =
        (meseFiltro === 0 || meseTurno === meseFiltro) &&
        (!isNaN(annoFiltro) && annoTurno === annoFiltro);

      const dentroSettimana = dataObj >= inizioSettimana && dataObj <= fineSettimana;

      if (passaFiltroMese && dentroSettimana) {
        const giorno = dataObj.toLocaleDateString("it-IT", {
          weekday: "long", day: "2-digit", month: "2-digit", year: "numeric"
        });

        const ore = calcolaOre(t.oraInizio, t.oraFine, t.pausa);
        let guadagnoBase = ore * impostazioniCorrenti.pagaOraria;
        let maggiorazione = 0;

        if (t.festivo) maggiorazione += guadagnoBase * (impostazioniCorrenti.extraFestivo / 100);
        if (giornoSettimana === 0) maggiorazione += guadagnoBase * (impostazioniCorrenti.extraDomenicale / 100);

        const oreNotturne = calcolaOreNotturne(
          t.oraInizio, t.oraFine,
          impostazioniCorrenti.fasciaNotteInizio,
          impostazioniCorrenti.fasciaNotteFine
        );
        if (oreNotturne > 0) {
          const notturnoBase = oreNotturne * impostazioniCorrenti.pagaOraria;
          maggiorazione += notturnoBase * (impostazioniCorrenti.extraNotturno / 100);
        }

        const guadagnoTotale = guadagnoBase + maggiorazione;
        const netto = guadagnoTotale - (guadagnoTotale * (impostazioniCorrenti.percentualeTasse / 100));

        // Solo per il mese corrente
        const oggi = new Date();
        if (meseTurno === oggi.getMonth() + 1 && annoTurno === oggi.getFullYear()) {
          totaleOreMese += ore;
          totaleGuadagnoMese += guadagnoTotale;
        }

        // Classe riga
        let rowClass = "normale";
        if (t.festivo) rowClass = "festivo";
        else if (giornoSettimana === 0) rowClass = "domenica";
        else if (oreNotturne > 0) rowClass = "notturno";

        righe.push(`
          <tr data-id="${t.id}" class="${rowClass}">
            <td>${giorno}</td>
            <td>${t.oraInizio} - ${t.oraFine}</td>
            <td>${t.pausa} min</td>
            <td>${ore.toFixed(2)}</td>
            <td>€${guadagnoTotale.toFixed(2)}</td>
            <td>€${netto.toFixed(2)}</td>
            <td>
              <button class="modifica-btn">✏️</button>
              <button class="elimina-btn">🗑️</button>
            </td>
          </tr>
        `);
      }

      cursor.continue();
    } else {
      // ✅ Aggiungi righe di malattia UNA VOLTA QUI, dopo il loop dei turni
      if (window.listaMalattie && meseFiltro !== 0) {
        const giorniMalattiaRenderizzati = new Set();

        const malattieInSettimana = window.listaMalattie.filter(m => {
          const fine = new Date(m.fine);
          fine.setHours(23, 59, 59, 999);
          return fine >= inizioSettimana && m.inizio <= fineSettimana;
        });

        malattieInSettimana.forEach(m => {
          const inizio = new Date(Math.max(m.inizio, inizioSettimana));
          const fine = new Date(Math.min(m.fine, fineSettimana));
          for (let d = new Date(inizio); d <= fine; d.setDate(d.getDate() + 1)) {
            const dataISO = d.toISOString().split("T")[0];
            if (giorniMalattiaRenderizzati.has(dataISO)) continue;
            giorniMalattiaRenderizzati.add(dataISO);
          
            const giorno = d.toLocaleDateString("it-IT", {
              weekday: "long", day: "2-digit", month: "2-digit", year: "numeric"
            });
          
            const isInizio = d.toDateString() === m.inizio.toDateString();
            const isFine = d.toDateString() === m.fine.toDateString();
            const mostraPulsante = isInizio || isFine;
          
            const infoTurno = m.turniSostituiti?.[dataISO];
            const testoExtra = infoTurno ? ` (eri di turno: ${infoTurno.oraInizio} - ${infoTurno.oraFine})` : "";
          
            righe.push(`
              <tr class="malattia" data-malattia-id="${m.id}" data-malattia-data="${d.toISOString()}">
                <td>${giorno}</td>
                <td colspan="5">Assenza per malattia${testoExtra}</td>
                <td>
                  ${mostraPulsante ? '<button class="elimina-malattia-btn" title="Elimina giorno di malattia">🗑️</button>' : ''}
                </td>
              </tr>
            `);
          }
          
        });
      }

      // ✅ Scrive la tabella UNA volta
      lista.innerHTML = righe.join("");
      // Rimuove malattia
      lista.querySelectorAll(".elimina-malattia-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
          const row = e.target.closest("tr");
          const id = parseInt(row.dataset.malattiaId, 10);
          const giorno = new Date(row.dataset.malattiaData);
          eliminaGiornoMalattia(id, giorno);
        });
      });


      // ✅ Riaggancia eventi
      lista.querySelectorAll("tr").forEach(row => {
        const id = parseInt(row.dataset.id, 10);
        row.querySelector(".modifica-btn")?.addEventListener("click", () => modificaTurno(id));
        row.querySelector(".elimina-btn")?.addEventListener("click", () => eliminaTurno(id));
      });

      // ✅ Totali 
      const now = new Date();
      const meseCorrente = now.getMonth() + 1;
      const annoCorrente = now.getFullYear();
      const oreContrattoMese = calcolaOreContrattualiMese(annoCorrente, meseCorrente, impostazioniCorrenti.oreSettimanali);
      const nettoTotale = totaleGuadagnoMese - (totaleGuadagnoMese * (impostazioniCorrenti.percentualeTasse / 100));
      const straordinarie = Math.max(0, totaleOreMese - oreContrattoMese);

      document.getElementById("totali-mese").innerHTML = `
        <strong>Totale Mese Corrente:</strong><br/>
        Totale ore: ${totaleOreMese.toFixed(2)}<br/>
        Ore da contratto (mese): ${oreContrattoMese.toFixed(2)}<br/>
        Ore straordinarie: ${straordinarie.toFixed(2)}<br/>
        Guadagno lordo: €${totaleGuadagnoMese.toFixed(2)}<br/>
        Guadagno netto (stimato): €${nettoTotale.toFixed(2)}
      `;
    }
  };
}


function calcolaOreContrattualiMese(anno, mese, oreSettimanaliContratto) {
  const primoGiorno = new Date(anno, mese - 1, 1); // mese: 1-12
  const ultimoGiorno = new Date(anno, mese, 0);
  const giorniTotali = ultimoGiorno.getDate();
  let settimane = 0;

  for (let giorno = 1; giorno <= giorniTotali; giorno++) {
    const data = new Date(anno, mese - 1, giorno);
    if (data.getDay() === 1) { // lunedì
      settimane++;
    }
  }

  const giorniRimasti = giorniTotali - (settimane * 7);
  const frazioneSettimana = giorniRimasti / 7;

  return oreSettimanaliContratto * (settimane + frazioneSettimana);
}

async function esportaBackup() {
  console.log("Esportazione del backup in corso...");
  const backup = {
    timestamp: new Date().toISOString(),
    turni: [],
    impostazioni: null,
    stipendi: {},
  };

  // Leggi turni
  const tx1 = db.transaction("turni", "readonly");
  const store1 = tx1.objectStore("turni");
  const req1 = store1.getAll();
  req1.onsuccess = () => {
    backup.turni = req1.result;

    // Leggi impostazioni
    const tx2 = db.transaction("impostazioni", "readonly");
    const store2 = tx2.objectStore("impostazioni");
    const req2 = store2.get("config");
    req2.onsuccess = () => {
      backup.impostazioni = req2.result;

      // Leggi stipendi
      const tx3 = db.transaction("stipendi", "readonly");
      const store3 = tx3.objectStore("stipendi");
      const req3 = store3.getAll();
      req3.onsuccess = () => {
        store3.openCursor().onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            backup.stipendi[cursor.key] = cursor.value;
            cursor.continue();
          } else {
            const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `backup_turni_${new Date().toISOString().split("T")[0]}.json`;
            document.body.appendChild(a);
            a.click();
            a.remove();
          }
        };
      };
    };
  };
}

function importaBackup(event) {
  console.log("Importazione del backup in corso...");
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async function (e) {
    try {
      const dati = JSON.parse(e.target.result);
      if (!dati.turni || !dati.impostazioni) {
        alert("File non valido.");
        return;
      }

      if (!confirm("Importando un backup sovrascriverai i dati attuali. Continuare?")) return;

      // Cancella database attuale
      const tx1 = db.transaction("turni", "readwrite");
      tx1.objectStore("turni").clear();
      const tx2 = db.transaction("impostazioni", "readwrite");
      tx2.objectStore("impostazioni").clear();
      const tx3 = db.transaction("stipendi", "readwrite");
      tx3.objectStore("stipendi").clear();

      // Ripristina dati
      const storeTurni = db.transaction("turni", "readwrite").objectStore("turni");
      dati.turni.forEach(t => storeTurni.put(t));

      const storeImp = db.transaction("impostazioni", "readwrite").objectStore("impostazioni");
      storeImp.put(dati.impostazioni, "config");

      const storeStip = db.transaction("stipendi", "readwrite").objectStore("stipendi");
      for (const [k, v] of Object.entries(dati.stipendi)) {
        storeStip.put(v, k);
      }

      setTimeout(() => {
        alert("Backup importato con successo.");
        caricaImpostazioniNelForm();
        loadTurni();
        controllaTurnoOggi();
        generaListaStipendi();
      }, 500);

    } catch (err) {
      alert("Errore nel leggere il file di backup.");
      console.error(err);
    }
  };
  reader.readAsText(file);
}

function apriPopupMalattia() {
  document.getElementById("malattia-popup").style.display = "block";
}
function chiudiPopupMalattia() {
  document.getElementById("malattia-popup").style.display = "none";
}
async function salvaMalattia() {
  const inizioStr = document.getElementById("malattia-inizio").value;
  const fineStr = document.getElementById("malattia-fine").value;
  const protocollo = document.getElementById("malattia-protocollo").value;

  if (!inizioStr || !fineStr) {
    alert("Inserisci sia inizio che fine della malattia.");
    return;
  }

  const inizio = new Date(inizioStr);
  const fine = new Date(fineStr);
  inizio.setHours(0, 0, 0, 0);
  fine.setHours(23, 59, 59, 999);

  if (inizio > fine) {
    alert("La data di inizio deve essere prima della data di fine.");
    return;
  }

  const giorni = [];
  for (let d = new Date(inizio); d <= fine; d.setDate(d.getDate() + 1)) {
    giorni.push(new Date(d));
  }

  // 1. Verifica se ci sono turni nei giorni di malattia
  const turniConflitto = [];
  const turniDaSostituire = [];

  for (const giorno of giorni) {
    const isoDate = giorno.toISOString().split("T")[0];
    const turno = await getTurnoByData(isoDate);
    const turni = await getTurnoByData(isoDate);
if (turni.length > 0) {
  turniConflitto.push(isoDate);
  turni.forEach(t => {
    turniDaSostituire.push({ data: isoDate, oraInizio: t.oraInizio, oraFine: t.oraFine });
  });
}

  }

  if (turniConflitto.length > 0) {
    const conferma = confirm(
      `Attenzione: ci sono ${turniConflitto.length} giorno/i con turno.\n` +
      `Vuoi sostituirli con malattia?\nI turni verranno cancellati ma segnalati nel calendario.`
    );
    if (!conferma) return;
  }

  // 2. Unione con malattie esistenti
  const tutteMalattie = await getMalattieRaw(); // restituisce anche id, inizio, fine
  const nuoveInizio = new Date(inizio);
  const nuoveFine = new Date(fine);

  const daUnire = tutteMalattie.filter(m =>
    (nuoveInizio <= m.fine && nuoveFine >= m.inizio) ||
    (nuoveInizio.getTime() === m.fine.getTime() + 86400000) ||
    (nuoveFine.getTime() + 86400000 === m.inizio.getTime())
  );

  for (const m of daUnire) {
    nuoveInizio.setTime(Math.min(nuoveInizio.getTime(), m.inizio.getTime()));
    nuoveFine.setTime(Math.max(nuoveFine.getTime(), m.fine.getTime()));
  }

  const tx = db.transaction(["malattie", "turni"], "readwrite");
  const storeMalattie = tx.objectStore("malattie");
  const storeTurni = tx.objectStore("turni");

  // 3. Cancella vecchie malattie da unire
  for (const m of daUnire) {
    storeMalattie.delete(m.id);
  }

  // 4. Elimina turni conflittuali e salva i dati dei turni sovrascritti
  const giorniTurniSostituiti = {};

  
 
  const index = storeTurni.index("data");
  
  const promesse = giorni.map(giorno => {
    return new Promise(resolve => {
      const dataISO = giorno.toISOString().split("T")[0];
      const req = index.getAll(dataISO);
req.onsuccess = () => {
  const turni = req.result;
  turni.forEach(turno => {
    giorniTurniSostituiti[dataISO] = {
      oraInizio: turno.oraInizio,
      oraFine: turno.oraFine
    };
    storeTurni.delete(turno.id);
  });
  resolve();
};

      req.onerror = () => resolve();
    });
  });
  
  await Promise.all(promesse);
  
  
  

  // 5. Crea nuova malattia unica
  const nuovaMalattia = {
    inizio: nuoveInizio.toISOString(),
    fine: nuoveFine.toISOString(),
    numeroProtocollo: protocollo || null,
    turniSostituiti: giorniTurniSostituiti
  };

  storeMalattie.add(nuovaMalattia);

  tx.oncomplete = async () => {
    chiudiPopupMalattia();
    window.listaMalattie = await getMalattie(); // aggiorna cache
    loadTurni();
    generaListaStipendi();
  };
}

async function getMalattieRaw() {
  return new Promise((resolve) => {
    const tx = db.transaction("malattie", "readonly");
    const store = tx.objectStore("malattie");
    const req = store.getAll();

    req.onsuccess = () => {
      const dati = req.result.map(m => ({
        id: m.id,
        inizio: new Date(m.inizio),
        fine: new Date(m.fine)
      }));
      resolve(dati);
    };
  });
}

function getTurnoByData(data) {
  return new Promise((resolve) => {
    const tx = db.transaction("turni", "readonly");
    const store = tx.objectStore("turni");
    const index = store.index("data");
    const req = index.getAll(data);
    req.onsuccess = () => resolve(req.result || []);
  });
}



async function getMalattie() {
  return new Promise((resolve) => {
    const tx = db.transaction("malattie", "readonly");
    const store = tx.objectStore("malattie");
    const req = store.getAll();
    req.onsuccess = () => {
      const dati = req.result.map(m => ({
        id: m.id,
        inizio: new Date(m.inizio),
        fine: new Date(m.fine),
        turniSostituiti: m.turniSostituiti || {},
        numeroProtocollo: m.numeroProtocollo || null
      }));
      resolve(dati);
    };
  });
}


function getSettimanaISO(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const giornoSettimana = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - giornoSettimana);
  const annoInizio = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const numSettimana = Math.ceil((((d - annoInizio) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(numSettimana).padStart(2, '0')}`;
}

function calcolaGuadagnoMalattia(anno, mese, oreMalattia) {
  const paga = impostazioniCorrenti.pagaOraria;
  const percMalattia = parseFloat(impostazioniCorrenti.percentualeMalattia || 75);
  const primi3Pagati = impostazioniCorrenti.malattiaPrimiTreGiorniPagati;
  const giorni = getGiorniMalattiaNelMese(anno, mese);

  if (!giorni.length || oreMalattia <= 0) return 0;

  const orePerGiorno = oreMalattia / giorni.length;

  let guadagno = 0;
  giorni.forEach((_, i) => {
    const percentuale = (i < 3 && primi3Pagati) ? 100 : percMalattia;
    guadagno += orePerGiorno * paga * (percentuale / 100);
  });

  return guadagno;
}


function getGiorniMalattiaNelMese(anno, mese) {
  const giorni = [];
  const inizioMese = new Date(anno, mese - 1, 1);
  const fineMese = new Date(anno, mese, 0);

  for (const { inizio, fine } of window.listaMalattie || []) {
    const inizioValido = new Date(Math.max(inizio, inizioMese));
    const fineValido = new Date(Math.min(fine, fineMese));

    for (let d = new Date(inizioValido); d <= fineValido; d.setDate(d.getDate() + 1)) {
      giorni.push(new Date(d));
    }
  }

  return giorni;
}




//FUNZIONE TEMPORANEA DI DEBUG
function logTuttiITurni() {
  const tx = db.transaction("turni", "readonly");
  const store = tx.objectStore("turni");
  store.getAll().onsuccess = (e) => {
    console.log("Turni attuali nel DB:", e.target.result);
  };
}

function correggiTurniSenzaId() {
  const tx = db.transaction("turni", "readwrite");
  const store = tx.objectStore("turni");
  const req = store.openCursor();

  req.onsuccess = (event) => {
    const cursor = event.target.result;
    if (cursor) {
      const turno = cursor.value;

      if (!turno.id) {
        turno.id = cursor.key; // assegna l'id mancante
        console.log(`Aggiungo id=${cursor.key} al turno del ${turno.data}`);
        store.put(turno); // sovrascrive con id incluso
      }

      cursor.continue();
    } else {
      console.log("✅ Correzione completata.");
    }
  };
}
