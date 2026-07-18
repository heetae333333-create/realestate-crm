const state = { client:null, session:null, profile:null, view:'dashboard', customers:[], listings:[], members:[] };
const $ = (s)=>document.querySelector(s);
const $$ = (s)=>[...document.querySelectorAll(s)];
const SUPA_URL_KEY='crm_supabase_url', SUPA_ANON_KEY='crm_supabase_anon';

function toast(msg){const el=$('#toast');el.textContent=msg;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2600)}
function showOnly(id){['setupScreen','authScreen','pendingScreen','appScreen'].forEach(x=>$('#'+x).classList.toggle('hidden',x!==id))}
function fmtMoney(v){if(v===null||v===undefined||v==='')return '-';return Number(v).toLocaleString('ko-KR')+'만원'}
function fmtDate(v){return v?new Date(v).toLocaleDateString('ko-KR'):'-'}
function badge(text,type='gray'){return `<span class="badge ${type}">${text}</span>`}
function escapeHtml(v=''){return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}

function initClient(){
  const url=localStorage.getItem(SUPA_URL_KEY), key=localStorage.getItem(SUPA_ANON_KEY);
  if(!url||!key){showOnly('setupScreen');return false}
  state.client=window.supabase.createClient(url,key);
  return true;
}

async function boot(){
  if(!initClient())return;
  const {data:{session}}=await state.client.auth.getSession();
  state.session=session;
  if(!session){showOnly('authScreen');return}
  await loadProfile();
}

async function loadProfile(){
  const {data,error}=await state.client.from('profiles').select('*').eq('id',state.session.user.id).single();
  if(error){toast('프로필을 불러오지 못했습니다.');showOnly('authScreen');return}
  state.profile=data;
  if(data.status!=='approved'){showOnly('pendingScreen');return}
  showOnly('appScreen');
  $('#officeNameSide').textContent=data.office_name||'';
  $('#userBadge').innerHTML=`<strong>${escapeHtml(data.full_name)}</strong><div class="muted">${data.role==='admin'?'관리자':'공인중개사'}</div>`;
  $$('.admin-only').forEach(el=>el.classList.toggle('hidden',data.role!=='admin'));
  renderView('dashboard');
}

async function renderView(view){
  state.view=view;
  $$('.nav').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
  const titles={dashboard:['대시보드','내 고객과 공동매물 현황'],customers:['내 고객','담당 고객은 본인과 관리자만 열람'],myListings:['내 매물 시트','등록한 매물은 공동매물망에 자동 공개'],network:['공동매물망','승인된 중개사라면 전체 매물 검색 가능'],members:['회원 승인·관리','가입 승인, 정지 및 계정 상태 관리'],transfer:['퇴사자 일괄 이관','고객과 매물을 다른 중개사에게 안전하게 이관']};
  $('#pageTitle').textContent=titles[view][0];$('#pageSubtitle').textContent=titles[view][1];$('#topActions').innerHTML='';
  if(view==='dashboard')await renderDashboard();
  if(view==='customers')await renderCustomers();
  if(view==='myListings')await renderMyListings();
  if(view==='network')await renderNetwork();
  if(view==='members')await renderMembers();
  if(view==='transfer')await renderTransfer();
}

async function loadCustomers(){
  const {data,error}=await state.client.from('customers').select('*').order('created_at',{ascending:false});
  if(error)throw error;state.customers=data||[];
}
async function loadListings(){
  const {data,error}=await state.client.from('listings').select('*, owner:profiles!listings_owner_id_fkey(full_name,office_name,phone)').order('updated_at',{ascending:false});
  if(error)throw error;state.listings=data||[];
}
async function loadMembers(){
  const {data,error}=await state.client.from('profiles').select('*').order('created_at',{ascending:false});
  if(error)throw error;state.members=data||[];
}

async function renderDashboard(){
  try{await Promise.all([loadCustomers(),loadListings()]);}catch(e){toast(e.message)}
  const mine=state.listings.filter(x=>x.owner_id===state.profile.id), active=state.listings.filter(x=>x.status==='available');
  $('#content').innerHTML=`
    <div class="grid stats">
      <div class="card stat"><div class="label">내 담당 고객</div><div class="value">${state.customers.length}</div></div>
      <div class="card stat"><div class="label">내 보유 매물</div><div class="value">${mine.length}</div></div>
      <div class="card stat"><div class="label">공동매물 전체</div><div class="value">${state.listings.length}</div></div>
      <div class="card stat"><div class="label">거래 가능 매물</div><div class="value">${active.length}</div></div>
    </div>
    <div class="split" style="margin-top:16px">
      <div class="panel"><div class="panel-head"><h3>최근 공동매물</h3><button class="ghost" onclick="renderView('network')">전체보기</button></div>${listingMini(state.listings.slice(0,6))}</div>
      <div class="panel"><div class="panel-head"><h3>최근 담당 고객</h3><button class="ghost" onclick="renderView('customers')">전체보기</button></div>${customerMini(state.customers.slice(0,6))}</div>
    </div>`;
}
function listingMini(rows){return rows.length?`<div class="list">${rows.map(x=>`<div class="list-item"><div><strong>${escapeHtml(x.title)}</strong><div class="muted">${escapeHtml(x.district||'')} · ${escapeHtml(x.transaction_type)} · ${fmtMoney(x.price)}</div></div>${badge(x.status==='available'?'거래 가능':'관리 중',x.status==='available'?'green':'gray')}</div>`).join('')}</div>`:'<div class="empty">등록된 매물이 없습니다.</div>'}
function customerMini(rows){return rows.length?`<div class="list">${rows.map(x=>`<div class="list-item"><div><strong>${escapeHtml(x.name)}</strong><div class="muted">${escapeHtml(x.customer_type)} · ${escapeHtml(x.phone||'')}</div></div>${badge(x.status||'신규','blue')}</div>`).join('')}</div>`:'<div class="empty">등록된 고객이 없습니다.</div>'}

async function renderCustomers(){
  await loadCustomers();
  $('#topActions').innerHTML='<button class="primary" onclick="openCustomerModal()">+ 고객 등록</button>';
  $('#content').innerHTML=`<div class="panel"><div class="filters"><input id="customerSearch" placeholder="이름·연락처 검색" oninput="filterCustomers()"><select id="customerType" onchange="filterCustomers()"><option value="">전체 구분</option><option>매수</option><option>매도</option><option>임차</option><option>임대</option></select><select id="customerStatus" onchange="filterCustomers()"><option value="">전체 상태</option><option>신규</option><option>상담중</option><option>매물제안</option><option>방문예정</option><option>계약협의</option><option>계약완료</option><option>보류</option></select></div><div id="customerTable"></div></div>`;
  filterCustomers();
}
function filterCustomers(){
  const q=($('#customerSearch')?.value||'').toLowerCase(), t=$('#customerType')?.value||'', s=$('#customerStatus')?.value||'';
  const rows=state.customers.filter(x=>(!q||`${x.name} ${x.phone}`.toLowerCase().includes(q))&&(!t||x.customer_type===t)&&(!s||x.status===s));
  $('#customerTable').innerHTML=rows.length?`<div class="table-wrap"><table><thead><tr><th>고객명</th><th>연락처</th><th>구분</th><th>희망지역</th><th>희망금액</th><th>상태</th><th>다음 연락일</th><th>관리</th></tr></thead><tbody>${rows.map(x=>`<tr><td><strong>${escapeHtml(x.name)}</strong></td><td>${escapeHtml(x.phone||'-')}</td><td>${escapeHtml(x.customer_type)}</td><td>${escapeHtml(x.preferred_area||'-')}</td><td>${fmtMoney(x.budget_max)}</td><td>${badge(x.status||'신규','blue')}</td><td>${fmtDate(x.next_contact_at)}</td><td><div class="row-actions"><button class="ghost" onclick="openCustomerModal('${x.id}')">수정</button><button class="danger" onclick="deleteCustomer('${x.id}')">삭제</button></div></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">조건에 맞는 고객이 없습니다.</div>';
}
function openCustomerModal(id){
  const x=state.customers.find(v=>v.id===id)||{};$('#modalTitle').textContent=id?'고객 수정':'고객 등록';
  $('#modalBody').innerHTML=`<div class="form-grid"><label>고객명<input name="name" value="${escapeHtml(x.name||'')}" required></label><label>연락처<input name="phone" value="${escapeHtml(x.phone||'')}"></label><label>고객 구분<select name="customer_type"><option>매수</option><option>매도</option><option>임차</option><option>임대</option></select></label><label>상태<select name="status"><option>신규</option><option>상담중</option><option>매물제안</option><option>방문예정</option><option>계약협의</option><option>계약완료</option><option>보류</option></select></label><label>희망 지역<input name="preferred_area" value="${escapeHtml(x.preferred_area||'')}"></label><label>희망 최대금액(만원)<input name="budget_max" type="number" value="${x.budget_max||''}"></label><label>다음 연락일<input name="next_contact_at" type="date" value="${x.next_contact_at?x.next_contact_at.slice(0,10):''}"></label><label class="span-2">상담 메모<textarea name="notes" rows="5">${escapeHtml(x.notes||'')}</textarea></label></div>`;
  $('#modalBody').querySelector('[name=customer_type]').value=x.customer_type||'매수';$('#modalBody').querySelector('[name=status]').value=x.status||'신규';
  $('#modalSubmit').onclick=async(e)=>{e.preventDefault();const fd=new FormData($('#modalForm'));const payload=Object.fromEntries(fd.entries());payload.owner_id=state.profile.id;payload.budget_max=payload.budget_max?Number(payload.budget_max):null;payload.next_contact_at=payload.next_contact_at||null;const q=id?state.client.from('customers').update(payload).eq('id',id):state.client.from('customers').insert(payload);const {error}=await q;if(error)return toast(error.message);$('#modal').close();toast('저장했습니다.');renderCustomers()};$('#modal').showModal();
}
async function deleteCustomer(id){if(!confirm('이 고객을 삭제할까요?'))return;const {error}=await state.client.from('customers').delete().eq('id',id);if(error)return toast(error.message);toast('삭제했습니다.');renderCustomers()}

async function renderMyListings(){await loadListings();state.myListings=state.listings.filter(x=>x.owner_id===state.profile.id);$('#topActions').innerHTML='<button class="primary" onclick="openListingModal()">+ 매물 등록</button>';$('#content').innerHTML=`<div class="notice" style="margin-bottom:14px">이 시트에서 등록한 매물은 공개 상태가 ‘공개’인 경우 공동매물망에 자동으로 올라갑니다.</div><div class="panel"><div id="myListingTable"></div></div>`;renderListingTable(state.myListings,'myListingTable',true)}
async function renderNetwork(){await loadListings();$('#content').innerHTML=`<div class="panel"><div class="filters"><input id="listingSearch" placeholder="매물명·주소·중개사 검색" oninput="filterNetwork()"><select id="listingTx" onchange="filterNetwork()"><option value="">전체 거래</option><option>매매</option><option>전세</option><option>월세</option></select><select id="listingType" onchange="filterNetwork()"><option value="">전체 유형</option><option>아파트</option><option>오피스텔</option><option>빌라</option><option>상가</option><option>사무실</option><option>토지</option></select><select id="listingStatus" onchange="filterNetwork()"><option value="">전체 상태</option><option value="available">거래 가능</option><option value="hold">협의 중</option><option value="complete">거래 완료</option></select><input id="listingMax" type="number" placeholder="최대금액(만원)" oninput="filterNetwork()"></div><div id="networkTable"></div></div>`;filterNetwork()}
function filterNetwork(){const q=($('#listingSearch')?.value||'').toLowerCase(),tx=$('#listingTx')?.value||'',ty=$('#listingType')?.value||'',st=$('#listingStatus')?.value||'',mx=Number($('#listingMax')?.value||0);const rows=state.listings.filter(x=>x.is_public&&(!q||`${x.title} ${x.address} ${x.district} ${x.owner?.full_name} ${x.owner?.office_name}`.toLowerCase().includes(q))&&(!tx||x.transaction_type===tx)&&(!ty||x.property_type===ty)&&(!st||x.status===st)&&(!mx||Number(x.price||0)<=mx));renderListingTable(rows,'networkTable',false)}
function renderListingTable(rows,target,mine){
  const el=$('#'+target);el.innerHTML=rows.length?`<div class="table-wrap"><table><thead><tr><th>상태</th><th>거래</th><th>유형</th><th>매물명</th><th>지역·주소</th><th>금액</th><th>면적</th><th>담당 중개사</th><th>최종확인</th>${mine?'<th>관리</th>':''}</tr></thead><tbody>${rows.map(x=>`<tr><td>${badge(x.status==='available'?'거래 가능':x.status==='complete'?'거래 완료':'협의 중',x.status==='available'?'green':x.status==='complete'?'gray':'yellow')}</td><td>${escapeHtml(x.transaction_type)}</td><td>${escapeHtml(x.property_type)}</td><td><strong>${escapeHtml(x.title)}</strong>${x.is_public?'':' '+badge('비공개','red')}</td><td>${escapeHtml(x.district||'')} ${escapeHtml(x.address||'')}</td><td>${fmtMoney(x.price)}</td><td>${x.area_m2?x.area_m2+'㎡':'-'}</td><td>${escapeHtml(x.owner?.office_name||'')}<br><span class="muted">${escapeHtml(x.owner?.full_name||'')}</span></td><td>${fmtDate(x.last_confirmed_at||x.updated_at)}</td>${mine?`<td><div class="row-actions"><button class="ghost" onclick="openListingModal('${x.id}')">수정</button><button class="danger" onclick="deleteListing('${x.id}')">삭제</button></div></td>`:''}</tr>`).join('')}</tbody></table></div>`:'<div class="empty">조건에 맞는 매물이 없습니다.</div>';
}
function openListingModal(id){
  const x=state.listings.find(v=>v.id===id)||{};$('#modalTitle').textContent=id?'매물 수정':'매물 등록';
  $('#modalBody').innerHTML=`<div class="form-grid"><label>매물명<input name="title" value="${escapeHtml(x.title||'')}" required></label><label>거래 유형<select name="transaction_type"><option>매매</option><option>전세</option><option>월세</option></select></label><label>매물 유형<select name="property_type"><option>아파트</option><option>오피스텔</option><option>빌라</option><option>상가</option><option>사무실</option><option>토지</option></select></label><label>상태<select name="status"><option value="available">거래 가능</option><option value="hold">협의 중</option><option value="complete">거래 완료</option></select></label><label>지역<input name="district" value="${escapeHtml(x.district||'')}"></label><label>주소<input name="address" value="${escapeHtml(x.address||'')}"></label><label>금액(만원)<input name="price" type="number" value="${x.price||''}"></label><label>월세(만원)<input name="monthly_rent" type="number" value="${x.monthly_rent||''}"></label><label>전용면적(㎡)<input name="area_m2" type="number" step="0.01" value="${x.area_m2||''}"></label><label>입주 가능일<input name="move_in_date" type="date" value="${x.move_in_date||''}"></label><label>공개 여부<select name="is_public"><option value="true">공개</option><option value="false">비공개</option></select></label><label>최종 확인일<input name="last_confirmed_at" type="date" value="${x.last_confirmed_at?x.last_confirmed_at.slice(0,10):''}"></label><label class="span-2">상세 설명<textarea name="description" rows="5">${escapeHtml(x.description||'')}</textarea></label></div>`;
  ['transaction_type','property_type','status'].forEach(n=>$('#modalBody').querySelector(`[name=${n}]`).value=x[n]||({transaction_type:'매매',property_type:'아파트',status:'available'}[n]));$('#modalBody').querySelector('[name=is_public]').value=String(x.is_public!==false);
  $('#modalSubmit').onclick=async(e)=>{e.preventDefault();const fd=new FormData($('#modalForm'));const p=Object.fromEntries(fd.entries());p.owner_id=state.profile.id;p.is_public=p.is_public==='true';['price','monthly_rent','area_m2'].forEach(k=>p[k]=p[k]?Number(p[k]):null);p.move_in_date=p.move_in_date||null;p.last_confirmed_at=p.last_confirmed_at||new Date().toISOString().slice(0,10);const q=id?state.client.from('listings').update(p).eq('id',id):state.client.from('listings').insert(p);const {error}=await q;if(error)return toast(error.message);$('#modal').close();toast('저장했습니다. 공동매물망에 반영됩니다.');renderMyListings()};$('#modal').showModal();
}
async function deleteListing(id){if(!confirm('매물을 삭제할까요?'))return;const {error}=await state.client.from('listings').delete().eq('id',id);if(error)return toast(error.message);toast('삭제했습니다.');renderMyListings()}

async function renderMembers(){await loadMembers();$('#content').innerHTML=`<div class="panel"><div class="table-wrap"><table><thead><tr><th>이름</th><th>사무소</th><th>연락처</th><th>이메일</th><th>권한</th><th>상태</th><th>가입일</th><th>관리</th></tr></thead><tbody>${state.members.map(x=>`<tr><td><strong>${escapeHtml(x.full_name)}</strong></td><td>${escapeHtml(x.office_name||'-')}</td><td>${escapeHtml(x.phone||'-')}</td><td>${escapeHtml(x.email||'-')}</td><td>${x.role==='admin'?badge('관리자','blue'):badge('중개사','gray')}</td><td>${badge(x.status==='approved'?'승인':x.status==='pending'?'대기':x.status==='suspended'?'정지':'거절',x.status==='approved'?'green':x.status==='pending'?'yellow':'red')}</td><td>${fmtDate(x.created_at)}</td><td><div class="row-actions">${x.status==='pending'?`<button class="success" onclick="setMemberStatus('${x.id}','approved')">승인</button><button class="danger" onclick="setMemberStatus('${x.id}','rejected')">거절</button>`:''}${x.status==='approved'&&x.id!==state.profile.id?`<button class="danger" onclick="setMemberStatus('${x.id}','suspended')">정지</button>`:''}${x.status==='suspended'?`<button class="success" onclick="setMemberStatus('${x.id}','approved')">복구</button>`:''}</div></td></tr>`).join('')}</tbody></table></div></div>`}
async function setMemberStatus(id,status){const {error}=await state.client.from('profiles').update({status}).eq('id',id);if(error)return toast(error.message);toast('회원 상태를 변경했습니다.');renderMembers()}

async function renderTransfer(){await loadMembers();const approved=state.members.filter(x=>x.status==='approved');$('#content').innerHTML=`<div class="panel"><div class="notice danger-notice">퇴사자 이관은 고객과 매물의 현재 담당자를 변경합니다. 최초 등록자와 이관 이력은 그대로 보존됩니다.</div><div class="form-grid" style="margin-top:18px"><label>이관할 기존 담당자<select id="fromMember"><option value="">선택</option>${approved.filter(x=>x.id!==state.profile.id).map(x=>`<option value="${x.id}">${escapeHtml(x.full_name)} · ${escapeHtml(x.office_name||'')}</option>`).join('')}</select></label><label>새 담당자<select id="toMember"><option value="">선택</option>${approved.map(x=>`<option value="${x.id}">${escapeHtml(x.full_name)} · ${escapeHtml(x.office_name||'')}</option>`).join('')}</select></label><label>이관 사유<input id="transferReason" value="퇴사에 따른 일괄 이관"></label><label>이관 후 기존 계정<select id="afterStatus"><option value="suspended">이용 정지</option><option value="approved">유지</option></select></label></div><div style="margin-top:18px"><button class="primary" onclick="previewTransfer()">이관 대상 확인</button></div><div id="transferPreview" style="margin-top:18px"></div></div>`}
async function previewTransfer(){const from=$('#fromMember').value,to=$('#toMember').value;if(!from||!to)return toast('기존 담당자와 새 담당자를 선택하세요.');if(from===to)return toast('서로 다른 중개사를 선택하세요.');const [{count:cc},{count:lc}]=await Promise.all([state.client.from('customers').select('*',{count:'exact',head:true}).eq('owner_id',from),state.client.from('listings').select('*',{count:'exact',head:true}).eq('owner_id',from)]);$('#transferPreview').innerHTML=`<div class="panel"><h3>이관 예정</h3><p>고객 <strong>${cc||0}명</strong>, 매물 <strong>${lc||0}개</strong>를 새 담당자에게 이관합니다.</p><button class="danger" onclick="executeTransfer()">확인 후 전체 이관</button></div>`}
async function executeTransfer(){if(!confirm('고객과 매물을 실제로 이관할까요?'))return;const payload={p_from:$('#fromMember').value,p_to:$('#toMember').value,p_reason:$('#transferReason').value,p_after_status:$('#afterStatus').value};const {data,error}=await state.client.rpc('transfer_agent_assets',payload);if(error)return toast(error.message);toast(`이관 완료: 고객 ${data.customers}명, 매물 ${data.listings}개`);renderTransfer()}

$$('[data-auth-tab]').forEach(b=>b.onclick=()=>{$$('[data-auth-tab]').forEach(x=>x.classList.toggle('active',x===b));$('#loginForm').classList.toggle('hidden',b.dataset.authTab!=='login');$('#signupForm').classList.toggle('hidden',b.dataset.authTab!=='signup')});
$('#loginForm').onsubmit=async(e)=>{e.preventDefault();const {data,error}=await state.client.auth.signInWithPassword({email:$('#loginEmail').value,password:$('#loginPassword').value});if(error)return toast(error.message);state.session=data.session;await loadProfile()};
$('#signupForm').onsubmit=async(e)=>{e.preventDefault();const email=$('#signupEmail').value,password=$('#signupPassword').value;const {data,error}=await state.client.auth.signUp({email,password,options:{data:{full_name:$('#signupName').value,office_name:$('#signupOffice').value,phone:$('#signupPhone').value}}});if(error)return toast(error.message);toast('가입 신청이 완료되었습니다.');if(data.session){state.session=data.session;await loadProfile()}else{$$('[data-auth-tab]')[0].click()}};
$('#logoutBtn').onclick=$('#pendingLogoutBtn').onclick=async()=>{await state.client.auth.signOut();state.session=null;state.profile=null;showOnly('authScreen')};
$('#pendingRefreshBtn').onclick=loadProfile;
$('#saveSetupBtn').onclick=()=>{localStorage.setItem(SUPA_URL_KEY,$('#setupUrl').value.trim());localStorage.setItem(SUPA_ANON_KEY,$('#setupKey').value.trim());location.reload()};
$('#clearSetupBtn').onclick=()=>{localStorage.removeItem(SUPA_URL_KEY);localStorage.removeItem(SUPA_ANON_KEY);toast('설정을 삭제했습니다.')};
$('#openSetupBtn').onclick=()=>showOnly('setupScreen');
$$('.nav').forEach(b=>b.onclick=()=>renderView(b.dataset.view));
window.renderView=renderView;window.filterCustomers=filterCustomers;window.openCustomerModal=openCustomerModal;window.deleteCustomer=deleteCustomer;window.openListingModal=openListingModal;window.deleteListing=deleteListing;window.filterNetwork=filterNetwork;window.setMemberStatus=setMemberStatus;window.previewTransfer=previewTransfer;window.executeTransfer=executeTransfer;
boot();
