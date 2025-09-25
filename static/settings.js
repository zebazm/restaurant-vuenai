
let data = [];
const tableBody = () => document.querySelector("#menuTable tbody");

async function fetchMenu(){
  try{
    const res = await fetch(API_MENU);
    data = await res.json();
  }catch(e){
    data = JSON.parse(localStorage.getItem("menu_data")||"[]");
  }
  if(!Array.isArray(data)) data=[];
}

function renderTable(){
  const tbody = tableBody();
  tbody.innerHTML = "";
  data.forEach((item, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="index-col">${idx+1}</td>
      <td><input value="${item.name||""}" data-k="name"></td>
      <td><input class="price-input" type="number" step="0.01" value="${item.price||0}" data-k="price"></td>
      <td><input value="${item.img_ref||""}" data-k="img_ref"></td>
      <td><textarea data-k="ingredients">${item.ingredients||""}</textarea></td>
      <td><textarea data-k="description">${item.description||""}</textarea></td>
      <td><button class="del">✕</button></td>
    `;
    tr.querySelectorAll("input,textarea").forEach(el=>{
      el.addEventListener("input", (e)=>{
        const k = e.target.dataset.k;
        let v = e.target.value;
        if(k==="price") v = parseFloat(v||0);
        data[idx][k] = v;
        localStorage.setItem("menu_data", JSON.stringify(data));
      });
    });
    tr.querySelector(".del").addEventListener("click", ()=>{
      data.splice(idx,1);
      localStorage.setItem("menu_data", JSON.stringify(data));
      renderTable();
    });
    tbody.appendChild(tr);
  });
}

function saveLocally(){
  localStorage.setItem("menu_data", JSON.stringify(data));
}

async function saveServer(){
  saveLocally();
  try{
    const res = await fetch(API_MENU, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify(data)
    });
    const js = await res.json();
    alert("Saved ("+js.count+" items).");
  }catch(e){
    alert("Saved locally (offline).");
  }
}

function downloadJSON(){
  const blob = new Blob([JSON.stringify(data, null, 2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "menu.json";
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

function setUpControls(){
  document.getElementById("addRow").onclick = ()=>{
    data.push({name:"New Item", price:0, img_ref:"", ingredients:"", description:""});
    saveLocally(); renderTable();
  };
  document.getElementById("saveMenu").onclick = saveServer;
  document.getElementById("downloadMenu").onclick = downloadJSON;
  document.getElementById("loadMenu").addEventListener("change", (e)=>{
    const file = e.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try{
        data = JSON.parse(reader.result);
        localStorage.setItem("menu_data", JSON.stringify(data));
        renderTable();
      }catch(err){
        alert("Invalid JSON");
      }
    };
    reader.readAsText(file);
  });
}

(async function boot(){
  await fetchMenu();
  setUpControls();
  renderTable();
})();
