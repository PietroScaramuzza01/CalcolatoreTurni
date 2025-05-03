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
    const form = document.getElementById("impostazioni-form"); // 👈 AGGIUNGI QUESTA RIGA
  
    if (imp) {
      impostazioniCorrenti = { ...impostazioniCorrenti, ...imp };
      for (const key in imp) {
        if (form[key]) form[key].value = imp[key];
      }
  
      // ✅ Corretto ora puoi usare form["malattiaPrimiTreGiorniPagati"]
      if (form["malattiaPrimiTreGiorniPagati"]) {
        form["malattiaPrimiTreGiorniPagati"].checked = imp.malattiaPrimiTreGiorniPagati ?? false;
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
      if (el.name) impostazioni[el.name] = el.type === "number" ? parseFloat(el.value) : el.value;
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
    <button onclick="apriModaleStipendio('${chiave}', ${m.lordo.toFixed(2)}, ${m.ore.toFixed(2)})">Modifica stipendio effettivo</button>
  </div>`;
          };
        }
      });

    }
  };
}

function apriModaleStipendio(chiave, lordo, ore) {
  const modale = document.getElementById("modale-stipendio");
  modale.style.display = "flex";
  document.getElementById("modale-titolo").textContent = `Stipendio di ${chiave}`;
  document.getElementById("modale-dettagli").innerHTML = `
    Totale ore: ${ore}<br/>
    Guadagno lordo calcolato: €${lordo.toFixed(2)}<br/>
    Guadagno netto calcolato: €${(lordo - (lordo * impostazioniCorrenti.percentualeTasse / 100)).toFixed(2)}
  `;
  document.getElementById("stipendio-effettivo-input").value = "";
  document.getElementById("stipendio-effettivo-input").dataset.chiave = chiave;
  document.getElementById("stipendio-effettivo-input").dataset.lordo = lordo;
  document.getElementById("modale-confronto").innerHTML = "";
  generaListaStipendi();
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

let settimanaCorrente = 0; // 0 = questa settimana, -1 = precedente, +1 = successiva

document.getElementById("prev-settimana").addEventListener("click", () => {
  settimanaCorrente--;
  loadTurni();
});

document.getElementById("next-settimana").addEventListener("click", () => {
  settimanaCorrente++;
  loadTurni();
});

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

function loadTurni() {
  console.log("Caricamento dei turni in corso...");
  const lista = document.getElementById("lista-turni");
  lista.innerHTML = "";

  const meseFiltro = parseInt(document.getElementById("filtro-mese").value);
  const annoFiltro = parseInt(document.getElementById("filtro-anno").value);

  const tx = db.transaction("turni", "readonly");
  const store = tx.objectStore("turni");
  const index = store.index("data");
  const request = index.openCursor(null, "next");

  let totaleOreMese = 0;
  let totaleGuadagnoMese = 0;

  const inizioSettimana = getInizioSettimanaDelFiltro(settimanaCorrente);
  const fineSettimana = new Date(inizioSettimana);
  fineSettimana.setDate(fineSettimana.getDate() + 6);
  fineSettimana.setHours(23, 59, 59, 999);

  const settimanaLabel = `${inizioSettimana.toLocaleDateString()} - ${fineSettimana.toLocaleDateString()}`;
  document.getElementById("etichetta-settimana").textContent = `Settimana: ${settimanaLabel}`;

  const righe = [];

  request.onsuccess = (event) => {
    const cursor = event.target.result;
    if (cursor) {
      const t = cursor.value;
      const dataObj = new Date(t.data);
      const meseTurno = dataObj.getMonth() + 1;
      const annoTurno = dataObj.getFullYear();

      const passaFiltroMese =
        (meseFiltro === 0 || meseTurno === meseFiltro) &&
        (!isNaN(annoFiltro) && annoTurno === annoFiltro);

      const dentroSettimana = dataObj >= inizioSettimana && dataObj <= fineSettimana;
      const giornoSettimana = dataObj.getDay();

      const giorno = dataObj.toLocaleDateString("it-IT", {
        weekday: "long",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
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

      if (meseTurno === new Date().getMonth() + 1 && annoTurno === new Date().getFullYear()) {
        totaleOreMese += ore;
        totaleGuadagnoMese += guadagnoTotale;
      }

      if (passaFiltroMese && dentroSettimana) {
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
      lista.innerHTML = righe.join("");
      


      // Re-associa eventi dopo l'inserimento delle righe
      lista.querySelectorAll("tr").forEach(row => {
        const id = parseInt(row.dataset.id, 10);;
        row.querySelector(".modifica-btn")?.addEventListener("click", () => modificaTurno(id));
        row.querySelector(".elimina-btn")?.addEventListener("click", () => eliminaTurno(id));
      });

      // Totali
      const now = new Date();
      const meseCorrente = now.getMonth() + 1;
      const annoCorrente = now.getFullYear();
      const oreContrattoMese = calcolaOreContrattualiMese(
        annoCorrente,
        meseCorrente,
        impostazioniCorrenti.oreSettimanali
      );
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
function salvaMalattia() {
  const inizio = document.getElementById("malattia-inizio").value;
  const fine = document.getElementById("malattia-fine").value;
  const protocollo = document.getElementById("malattia-protocollo").value;

  if (!inizio || !fine) {
    alert("Inserisci sia inizio che fine della malattia.");
    return;
  }

  const tx = db.transaction("malattie", "readwrite");
  tx.objectStore("malattie").add({
    inizio,
    fine,
    numeroProtocollo: protocollo || null
  });

  tx.oncomplete = () => {
    chiudiPopupMalattia();
    loadTurni(); // o altra funzione per ricalcolare
  };
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
