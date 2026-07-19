const state = { client:null, session:null, profile:null, view:'dashboard', customers:[], listings:[], members:[], adminSelectedListings:new Set() };
const $ = (s)=>document.querySelector(s);
const $$ = (s)=>[...document.querySelectorAll(s)];
const SUPA_URL_KEY='crm_supabase_url', SUPA_ANON_KEY='crm_supabase_anon';

function toast(msg){const el=$('#toast');el.textContent=msg;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2600)}
function showOnly(id){['setupScreen','authScreen','pendingScreen','appScreen'].forEach(x=>$('#'+x).classList.toggle('hidden',x!==id))}
function fmtMoney(v){if(v===null||v===undefined||v==='')return '-';return Number(v).toLocaleString('ko-KR')+'만원'}
function fmtDate(v){return v?new Date(v).toLocaleDateString('ko-KR'):'-'}
function today(){return new Date().toISOString().slice(0,10)}
function dueBadge(v){if(!v)return '-';const d=new Date(v+'T00:00:00'),now=new Date(today()+'T00:00:00');const diff=Math.round((d-now)/86400000);return diff<0?badge(fmtDate(v)+' 지남','red'):diff===0?badge('오늘','yellow'):badge(fmtDate(v),'blue')}
function moveInText(x){return x.move_in_negotiable?'협의 가능':fmtDate(x.move_in_date)}
function contractStage(x){const stages=[['잔금',x.final_payment_date],['중도금',x.interim_payment_date],['본계약',x.contract_date],['가계약',x.provisional_contract_date]];const hit=stages.find(v=>v[1]);if(hit)return badge(hit[0],'blue');if(x.interim_payment_not_applicable)return badge('중도금 해당없음','gray');return '-'}
function contractDetailText(item,entityType){const parts=[];if(item.contracted_property_name)parts.push(`매물명: ${item.contracted_property_name}`);if(item.contracted_transaction_type)parts.push(`거래유형: ${item.contracted_transaction_type}`);if(item.contracted_amount!==null&&item.contracted_amount!==undefined&&item.contracted_amount!=='')parts.push(`${item.contracted_transaction_type==='월세'?'보증금':'거래금액'}: ${fmtMoney(item.contracted_amount)}`);if(item.contracted_transaction_type==='월세'&&item.contracted_monthly_rent!==null&&item.contracted_monthly_rent!==undefined&&item.contracted_monthly_rent!=='')parts.push(`월세: ${fmtMoney(item.contracted_monthly_rent)}`);if(item.counterparty_name)parts.push(`거래 고객명: ${item.counterparty_name}`);if(item.counterparty_phone){let label='상대방 연락처';if(entityType==='customer'){label=['매수','임차'].includes(item.customer_type)?'매도/임대측 연락처':'매수/임차측 연락처'}else label='매수/임차측 연락처';parts.push(`${label}: ${item.counterparty_phone}`)}return parts.join(' / ')}
function listingPriceText(x){return x.transaction_type==='월세'?`${fmtMoney(x.price)} / 월 ${fmtMoney(x.monthly_rent)}`:fmtMoney(x.price)}
function customerBudgetText(x){const base=fmtMoney(x.budget_max);return (x.deal_type||'').includes('월세')?`${base} / 월 ${fmtMoney(x.desired_monthly_rent)}`:base}
function badge(text,type='gray'){return `<span class="badge ${type}">${text}</span>`}
function gradeBadge(grade){const g=grade||'C';const colors={A:'grade-a',B:'grade-b',C:'grade-c',D:'grade-d'};return `<span class="customer-grade ${colors[g]||'grade-c'}">${escapeHtml(g)}</span>`}
function escapeHtml(v=''){return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}

function safeFileName(name='image.jpg'){
  const ext=(name.split('.').pop()||'jpg').toLowerCase().replace(/[^a-z0-9]/g,'')||'jpg';
  return `${crypto.randomUUID()}.${ext}`;
}
function canManageListing(listing){return !!listing&&(listing.owner_id===state.profile.id||state.profile.role==='admin')}
async function uploadListingPhotos(listingId,files){
  const list=[...(files||[])];
  if(!list.length)return {uploaded:0,failed:0};
  let uploaded=0,failed=0;
  for(const file of list){
    if(!file.type.startsWith('image/')){failed++;continue}
    if(file.size>10*1024*1024){failed++;continue}
    const path=`${listingId}/${safeFileName(file.name)}`;
    const {error:upError}=await state.client.storage.from('listing-photos').upload(path,file,{cacheControl:'3600',upsert:false,contentType:file.type});
    if(upError){failed++;continue}
    const {error:dbError}=await state.client.from('listing_photos').insert({listing_id:listingId,storage_path:path,file_name:file.name,uploaded_by:state.profile.id});
    if(dbError){await state.client.storage.from('listing-photos').remove([path]);failed++;continue}
    uploaded++;
  }
  return {uploaded,failed};
}
async function signedPhotoUrl(path){
  const {data,error}=await state.client.storage.from('listing-photos').createSignedUrl(path,3600);
  return error?null:data?.signedUrl||null;
}

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
  const titles={dashboard:['대시보드','내 고객과 공동매물 현황'],customers:['내 고객','담당 고객은 본인과 관리자만 열람'],myListings:['내 매물 시트','등록한 매물은 공동매물망에 자동 공개'],network:['공동매물망','승인된 중개사라면 전체 매물 검색 가능'],adminListings:['전체 매물 관리','공개·비공개와 관계없이 모든 중개사의 매물을 관리하고 개별 이관할 수 있습니다'],members:['회원 승인·관리','가입 승인, 정지 및 계정 상태 관리'],transfer:['퇴사자 일괄 이관','고객과 매물을 다른 중개사에게 안전하게 이관']};
  $('#pageTitle').textContent=titles[view][0];$('#pageSubtitle').textContent=titles[view][1];$('#topActions').innerHTML='';
  if(view==='dashboard')await renderDashboard();
  if(view==='customers')await renderCustomers();
  if(view==='myListings')await renderMyListings();
  if(view==='network')await renderNetwork();
  if(view==='adminListings')await renderAdminListings();
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
function listingMini(rows){return rows.length?`<div class="list">${rows.map(x=>`<div class="list-item"><div><strong>${escapeHtml(x.title)}</strong><div class="muted">${escapeHtml(x.district||'')} · ${escapeHtml(x.transaction_type)} · ${listingPriceText(x)}</div></div>${badge(x.status==='available'?'거래 가능':'관리 중',x.status==='available'?'green':'gray')}</div>`).join('')}</div>`:'<div class="empty">등록된 매물이 없습니다.</div>'}
function customerMini(rows){return rows.length?`<div class="list">${rows.map(x=>`<div class="list-item"><div><strong>${escapeHtml(x.name)}</strong><div class="muted">${escapeHtml(x.customer_type)} · ${escapeHtml(x.phone||'')}</div></div>${badge(x.status||'신규','blue')}</div>`).join('')}</div>`:'<div class="empty">등록된 고객이 없습니다.</div>'}

async function renderCustomers(){
  await loadCustomers();
  $('#topActions').innerHTML='<button class="primary" onclick="openCustomerModal()">+ 고객 등록</button>';
  $('#content').innerHTML=`<div class="panel"><div class="filters customer-filters"><input id="customerSearch" placeholder="이름·연락처 검색" oninput="filterCustomers()"><select id="customerType" onchange="filterCustomers()"><option value="">전체 구분</option><option>매수</option><option>매도</option><option>임차</option><option>임대</option></select><select id="customerStatus" onchange="filterCustomers()"><option value="">전체 상태</option><option>신규</option><option>상담중</option><option>매물제안</option><option>방문예정</option><option>계약협의</option><option>계약완료</option><option>보류</option></select><select id="customerDealType" onchange="filterCustomers()"><option value="">전체 거래유형</option><option>매매</option><option>전세</option><option>월세</option><option>매매+전세</option><option>매매+월세</option><option>전세+월세</option></select><select id="customerGrade" onchange="filterCustomers()"><option value="">전체 등급</option><option>A</option><option>B</option><option>C</option><option>D</option></select></div><div id="customerTable"></div></div>`;
  filterCustomers();
}
function filterCustomers(){
  const q=($('#customerSearch')?.value||'').toLowerCase(), t=$('#customerType')?.value||'', s=$('#customerStatus')?.value||'', d=$('#customerDealType')?.value||'', g=$('#customerGrade')?.value||'';
  const rows=state.customers.filter(x=>(!q||`${x.name} ${x.phone}`.toLowerCase().includes(q))&&(!t||x.customer_type===t)&&(!s||x.status===s)&&(!d||x.deal_type===d)&&(!g||x.customer_grade===g));
  $('#customerTable').innerHTML=rows.length?`<div class="table-wrap"><table class="customer-table"><thead><tr><th>고객명</th><th>연락처</th><th>구분</th><th>상태</th><th>거래유형</th><th>등급</th><th>희망지역</th><th>방개수</th><th>희망금액/월세</th><th>계약단계</th><th>최종 FU</th><th>예정 FU</th><th>관리</th></tr></thead><tbody>${rows.map(x=>`<tr><td><strong>${escapeHtml(x.name)}</strong></td><td>${escapeHtml(x.phone||'-')}</td><td>${escapeHtml(x.customer_type)}</td><td>${badge(x.status||'신규','blue')}</td><td>${escapeHtml(x.deal_type||'-')}</td><td>${gradeBadge(x.customer_grade)}</td><td>${escapeHtml(x.preferred_area||'-')}</td><td>${x.desired_rooms!==null&&x.desired_rooms!==undefined&&x.desired_rooms!==''?`${escapeHtml(String(x.desired_rooms))}개`:'-'}</td><td>${customerBudgetText(x)}</td><td>${contractStage(x)}</td><td>${fmtDate(x.last_follow_up_at)}</td><td>${dueBadge(x.next_follow_up_at)}</td><td><div class="row-actions"><button class="success" onclick="openFollowUpModal('customer','${x.id}')">FU</button><button class="ghost" onclick="openHistoryModal('customer','${x.id}')">히스토리</button><button class="ghost" onclick="openContractModal('customer','${x.id}')">계약일정</button><button class="ghost" onclick="openCustomerModal('${x.id}')">수정</button><button class="danger" onclick="deleteCustomer('${x.id}')">삭제</button></div></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">조건에 맞는 고객이 없습니다.</div>';
}
function openCustomerModal(id){
  const x=state.customers.find(v=>v.id===id)||{};$('#modalTitle').textContent=id?'고객 수정':'고객 등록';
  $('#modalBody').innerHTML=`<div class="form-grid"><label>고객명<input name="name" value="${escapeHtml(x.name||'')}" required></label><label>연락처<input name="phone" value="${escapeHtml(x.phone||'')}" placeholder="010-0000-0000" required></label><label>고객 구분<select id="customerKind" name="customer_type"><option>매수</option><option>매도</option><option>임차</option><option>임대</option></select></label><label>상태<select name="status"><option>신규</option><option>상담중</option><option>매물제안</option><option>방문예정</option><option>계약협의</option><option>계약완료</option><option>보류</option></select></label><label id="customerDealTypeWrap">거래유형<select name="deal_type"><option value="">선택</option><option>매매</option><option>전세</option><option>월세</option><option>매매+전세</option><option>매매+월세</option><option>전세+월세</option></select></label><label>고객등급<select name="customer_grade"><option>A</option><option>B</option><option>C</option><option>D</option></select></label><label>희망 지역<input name="preferred_area" value="${escapeHtml(x.preferred_area||'')}"></label><label id="customerRoomsWrap">희망 방개수<input name="desired_rooms" type="number" min="0" step="1" value="${x.desired_rooms??''}" placeholder="예: 3"></label><label>희망 보증금/최대금액(만원)<input name="budget_max" type="number" value="${x.budget_max||''}"></label><label id="customerMonthlyRentWrap">희망 월세(만원)<input name="desired_monthly_rent" type="number" min="0" value="${x.desired_monthly_rent??''}" placeholder="예: 100"></label><label id="customerLoanWrap">대출 여부<select name="loan_available"><option value="true">O</option><option value="false">X</option></select></label><label id="customerEquityWrap">자기자본금(만원)<div class="inline-field"><input id="equityCapitalInput" name="equity_capital" type="number" min="0" value="${x.equity_capital??''}" placeholder="예: 20000"><label class="inline-check"><input id="equityUnknownCheck" name="equity_unknown" type="checkbox" ${x.equity_unknown?'checked':''}> 모름</label></div></label><label>예정 FU<input name="next_follow_up_at" type="date" value="${x.next_follow_up_at?x.next_follow_up_at.slice(0,10):''}"></label><label class="span-2">상담 메모<textarea name="notes" rows="5">${escapeHtml(x.notes||'')}</textarea></label></div>`;
  const kind=$('#customerKind');kind.value=x.customer_type||'매수';
  const dealWrap=$('#customerDealTypeWrap'),roomsWrap=$('#customerRoomsWrap'),monthlyWrap=$('#customerMonthlyRentWrap'),loanWrap=$('#customerLoanWrap'),equityWrap=$('#customerEquityWrap'),equityInput=$('#equityCapitalInput'),equityUnknown=$('#equityUnknownCheck');
  const syncEquityUnknown=()=>{equityInput.disabled=equityUnknown.checked;if(equityUnknown.checked)equityInput.value='';};equityUnknown.onchange=syncEquityUnknown;syncEquityUnknown();const syncMonthlyField=()=>{const show=['매수','임차'].includes(kind.value)&&($('#modalBody [name=deal_type]').value||'').includes('월세');monthlyWrap.style.display=show?'':'none';if(!show)monthlyWrap.querySelector('input').value=''};const toggleBuyerFields=()=>{const show=['매수','임차'].includes(kind.value);[dealWrap,roomsWrap,loanWrap,equityWrap].forEach(el=>el.style.display=show?'':'none');if(!show){dealWrap.querySelector('select').value='';roomsWrap.querySelector('input').value='';loanWrap.querySelector('select').value='false';equityInput.value='';equityUnknown.checked=false;syncEquityUnknown()}syncMonthlyField()};$('#modalBody [name=deal_type]').onchange=syncMonthlyField;
  kind.onchange=toggleBuyerFields;toggleBuyerFields();
  $('#modalBody').querySelector('[name=status]').value=x.status||'신규';$('#modalBody').querySelector('[name=deal_type]').value=x.deal_type||'';$('#modalBody').querySelector('[name=customer_grade]').value=x.customer_grade||'C';$('#modalBody').querySelector('[name=loan_available]').value=x.loan_available===true?'true':'false';
  $('#modalSubmit').onclick=async(e)=>{e.preventDefault();const fd=new FormData($('#modalForm'));const payload=Object.fromEntries(fd.entries());payload.owner_id=state.profile.id;const buyerSide=['매수','임차'].includes(payload.customer_type);payload.deal_type=buyerSide?(payload.deal_type||null):null;payload.customer_grade=payload.customer_grade||'C';payload.budget_max=payload.budget_max?Number(payload.budget_max):null;payload.desired_monthly_rent=buyerSide&&(payload.deal_type||'').includes('월세')&&payload.desired_monthly_rent?Number(payload.desired_monthly_rent):null;payload.desired_rooms=buyerSide&&payload.desired_rooms!==''?Number(payload.desired_rooms):null;payload.loan_available=buyerSide?payload.loan_available==='true':null;payload.equity_unknown=buyerSide&&payload.equity_unknown==='on';payload.equity_capital=buyerSide&&!payload.equity_unknown&&payload.equity_capital?Number(payload.equity_capital):null;payload.official_price=null;payload.next_follow_up_at=payload.next_follow_up_at||null;delete payload.next_contact_at;const q=id?state.client.from('customers').update(payload).eq('id',id):state.client.from('customers').insert(payload);const {error}=await q;if(error)return toast(error.message);$('#modal').close();toast('저장했습니다.');renderCustomers()};$('#modal').showModal();
}
async function deleteCustomer(id){if(!confirm('이 고객을 삭제할까요?'))return;const {error}=await state.client.from('customers').delete().eq('id',id);if(error)return toast(error.message);toast('삭제했습니다.');renderCustomers()}

async function renderMyListings(){await loadListings();state.myListings=state.listings.filter(x=>x.owner_id===state.profile.id);$('#topActions').innerHTML='<button class="primary" onclick="openListingModal()">+ 매물 등록</button>';$('#content').innerHTML=`<div class="notice" style="margin-bottom:14px">이 시트에서 등록한 매물은 공개 상태가 ‘공개’인 경우 공동매물망에 자동으로 올라갑니다.</div><div class="panel"><div id="myListingTable"></div></div>`;renderListingTable(state.myListings,'myListingTable',true)}

async function renderAdminListings(){
  if(state.profile.role!=='admin')return renderView('dashboard');
  await Promise.all([loadListings(),loadMembers()]);
  $('#topActions').innerHTML='<button class="primary" onclick="openListingModal()">+ 관리자 매물 등록</button><button class="success" id="bulkTransferTopBtn" onclick="openBulkListingTransfer()" disabled>선택 매물 일괄 이관 (0)</button>'; state.adminSelectedListings.clear();
  $('#content').innerHTML=`<div class="notice" style="margin-bottom:14px">관리자는 모든 중개사의 공개·비공개 매물을 열람, 수정, 삭제하고 매물별로 담당자를 이관할 수 있습니다.</div><div class="panel"><div class="filters admin-listing-filters"><input id="adminListingSearch" placeholder="매물명·주소·담당자 검색" oninput="filterAdminListings()"><select id="adminListingOwner" onchange="filterAdminListings()"><option value="">전체 담당자</option>${state.members.filter(x=>x.status==='approved').map(x=>`<option value="${x.id}">${escapeHtml(x.full_name)} · ${escapeHtml(x.office_name||'')}</option>`).join('')}</select><select id="adminListingVisibility" onchange="filterAdminListings()"><option value="">공개+비공개</option><option value="public">공개</option><option value="private">비공개</option></select><select id="adminListingStatus" onchange="filterAdminListings()"><option value="">전체 상태</option><option value="available">거래 가능</option><option value="hold">협의 중</option><option value="complete">거래 완료</option></select></div><div class="bulk-listing-toolbar"><label class="inline-check"><input type="checkbox" id="selectAllAdminListings" onchange="toggleAllAdminListings(this.checked)"> 현재 목록 전체 선택</label><button class="primary" id="bulkTransferBtn" onclick="openBulkListingTransfer()" disabled>선택 매물 일괄 이관 (0)</button></div><div id="adminListingTable"></div></div>`;
  filterAdminListings();
}
function filterAdminListings(){
  const q=($('#adminListingSearch')?.value||'').toLowerCase(), owner=$('#adminListingOwner')?.value||'', visibility=$('#adminListingVisibility')?.value||'', status=$('#adminListingStatus')?.value||'';
  const rows=state.listings.filter(x=>(!q||`${x.title} ${x.address} ${x.district} ${x.owner?.full_name} ${x.owner?.office_name} ${x.contact_phone||''}`.toLowerCase().includes(q))&&(!owner||x.owner_id===owner)&&(!status||x.status===status)&&(!visibility||(visibility==='public'?x.is_public:!x.is_public)));
  renderListingTable(rows,'adminListingTable',true,true);
}
async function renderNetwork(){await loadListings();$('#content').innerHTML=`<div class="panel"><div class="filters"><input id="listingSearch" placeholder="매물명·주소·중개사 검색" oninput="filterNetwork()"><select id="listingTx" onchange="filterNetwork()"><option value="">전체 거래</option><option>매매</option><option>전세</option><option>월세</option></select><select id="listingType" onchange="filterNetwork()"><option value="">전체 유형</option><option>아파트</option><option>오피스텔</option><option>빌라</option><option>상가</option><option>사무실</option><option>토지</option></select><select id="listingStatus" onchange="filterNetwork()"><option value="">전체 상태</option><option value="available">거래 가능</option><option value="hold">협의 중</option><option value="complete">거래 완료</option></select><input id="listingMax" type="number" placeholder="최대금액(만원)" oninput="filterNetwork()"></div><div id="networkTable"></div></div>`;filterNetwork()}
function filterNetwork(){const q=($('#listingSearch')?.value||'').toLowerCase(),tx=$('#listingTx')?.value||'',ty=$('#listingType')?.value||'',st=$('#listingStatus')?.value||'',mx=Number($('#listingMax')?.value||0);const rows=state.listings.filter(x=>x.is_public&&(!q||`${x.title} ${x.address} ${x.district} ${x.owner?.full_name} ${x.owner?.office_name}`.toLowerCase().includes(q))&&(!tx||x.transaction_type===tx)&&(!ty||x.property_type===ty)&&(!st||x.status===st)&&(!mx||Number(x.price||0)<=mx));renderListingTable(rows,'networkTable',false)}
function listingAreaText(x){
  const full=`${x.district||''} ${x.address||''}`.replace(/\s+/g,' ').trim();
  const district=(full.match(/[가-힣0-9·-]+(?:구|군|시)(?=\s|$)/g)||[]).pop()||'';
  const dong=(full.match(/[가-힣0-9·-]+(?:동|가)(?=\s|$)/g)||[]).pop()||'';
  return [...new Set([district,dong].filter(Boolean))].join(' ')||x.district||'-';
}
function renderListingTable(rows,target,mine,adminMode=false){
  const el=$('#'+target);el.innerHTML=rows.length?`<div class="table-wrap listing-table-wrap"><table class="listing-table"><thead><tr>${adminMode?'<th class="select-col">선택</th>':''}<th>상태</th><th>거래</th><th>유형</th><th>매물명</th><th>지역</th><th>금액/월세</th><th>연락처</th><th>대출</th><th>면적</th><th>방/욕실</th><th>입주</th><th>담당</th><th>계약</th><th>최종 FU</th><th>예정 FU</th>${mine?'<th>관리</th>':''}</tr></thead><tbody>${rows.map(x=>`<tr>${adminMode?`<td class="select-col"><input type="checkbox" class="admin-listing-check" value="${x.id}" ${state.adminSelectedListings.has(x.id)?'checked':''} onchange="toggleAdminListingSelection('${x.id}',this.checked)"></td>`:''}<td>${badge(x.status==='available'?'거래 가능':x.status==='complete'?'거래 완료':'협의 중',x.status==='available'?'green':x.status==='complete'?'gray':'yellow')}</td><td>${escapeHtml(x.transaction_type)}</td><td>${escapeHtml(x.property_type)}</td><td class="listing-title-cell"><strong>${escapeHtml(x.title)}</strong>${x.is_public?'':' '+badge('비공개','red')}<br><button type="button" class="photo-link" onclick="openListingPhotos('${x.id}')">📷 내부사진</button></td><td>${escapeHtml(listingAreaText(x))}</td><td>${listingPriceText(x)}</td><td>${escapeHtml(x.contact_phone||'-')}</td><td>${x.loan_available===true?badge('O','green'):x.loan_available===false?badge('X','red'):badge('미확인','gray')}${x.loan_available===true&&x.official_price?`<br><span class="muted">기준 ${fmtMoney(x.official_price)}</span>`:''}</td><td>${x.area_m2?x.area_m2+'㎡':'-'}</td><td>${x.room_count!==null&&x.room_count!==undefined?escapeHtml(String(x.room_count)):'-'} / ${x.bathroom_count!==null&&x.bathroom_count!==undefined?escapeHtml(String(x.bathroom_count)):'-'}</td><td>${moveInText(x)}</td><td>${escapeHtml(x.owner?.full_name||'-')}</td><td>${contractStage(x)}</td><td>${fmtDate(x.last_follow_up_at||x.last_confirmed_at)}</td><td>${dueBadge(x.next_follow_up_at)}</td>${mine?`<td><div class="row-actions"><button class="success" onclick="openFollowUpModal('listing','${x.id}')">FU</button><button class="ghost" onclick="openHistoryModal('listing','${x.id}')">히스토리</button><button class="ghost" onclick="openContractModal('listing','${x.id}')">계약일정</button><button class="ghost" onclick="openListingModal('${x.id}')">수정</button>${adminMode?`<button class="primary" onclick="openSingleListingTransfer('${x.id}')">개별 이관</button>`:''}<button class="danger" onclick="deleteListing('${x.id}')">삭제</button></div></td>`:''}</tr>`).join('')}</tbody></table></div>`:'<div class="empty">조건에 맞는 매물이 없습니다.</div>';
  if(adminMode) updateBulkTransferControls();
}
function openListingModal(id){
  const x=state.listings.find(v=>v.id===id)||{};$('#modalTitle').textContent=id?'매물 수정':'매물 등록';
  $('#modalBody').innerHTML=`<div class="form-grid"><label>매물명<input name="title" value="${escapeHtml(x.title||'')}" required></label><label>매도/임대인 연락처<input name="contact_phone" value="${escapeHtml(x.contact_phone||'')}" placeholder="010-0000-0000" required></label><label>거래 유형<select name="transaction_type"><option>매매</option><option>전세</option><option>월세</option></select></label><label>매물 유형<select name="property_type"><option>아파트</option><option>오피스텔</option><option>빌라</option><option>상가</option><option>사무실</option><option>토지</option></select></label><label>상태<select name="status"><option value="available">거래 가능</option><option value="hold">협의 중</option><option value="complete">거래 완료</option></select></label><label>지역<input name="district" value="${escapeHtml(x.district||'')}"></label><label class="span-2">주소<input name="address" value="${escapeHtml(x.address||'')}"></label><label>금액(만원)<input name="price" type="number" value="${x.price||''}"></label><label>월세(만원)<input name="monthly_rent" type="number" value="${x.monthly_rent||''}"></label><label>관리비(만원)<input name="management_fee" type="number" step="0.1" value="${x.management_fee??''}"></label><label>전용면적(㎡)<input name="area_m2" type="number" step="0.01" value="${x.area_m2||''}"></label><label>방 개수<input name="room_count" type="number" min="0" step="1" value="${x.room_count??''}" placeholder="예: 3"></label><label>화장실 개수<input name="bathroom_count" type="number" min="0" step="1" value="${x.bathroom_count??''}" placeholder="예: 2"></label><label class="span-2">옵션<input name="options" value="${escapeHtml(x.options||'')}" placeholder="예: 에어컨, 냉장고, 세탁기, 붙박이장"></label><label>반려동물<select name="pet_allowed"><option>미확인</option><option>가능</option><option>불가</option><option>협의</option></select></label><label>대출 가능 여부<select id="listingLoanAvailable" name="loan_available"><option value="">미확인</option><option value="true">O</option><option value="false">X</option></select></label><label id="listingOfficialPriceWrap">공시지가/기준시가(만원)<input name="official_price" type="number" value="${x.official_price||''}"></label><label>입주 가능일<input id="moveInDateInput" name="move_in_date" type="date" value="${x.move_in_date||''}"></label><label class="check-label"><input id="moveInNegotiable" name="move_in_negotiable" type="checkbox" ${x.move_in_negotiable?'checked':''}> 입주일 협의 가능</label><label>예정 FU<input name="next_follow_up_at" type="date" value="${x.next_follow_up_at?x.next_follow_up_at.slice(0,10):''}"></label><label>공개 여부<select name="is_public"><option value="true">공개</option><option value="false">비공개</option></select></label><label>최종 확인일<input name="last_confirmed_at" type="date" value="${x.last_confirmed_at?x.last_confirmed_at.slice(0,10):''}"></label><label>다음 확인 예정일<input name="next_confirm_at" type="date" value="${x.next_confirm_at?x.next_confirm_at.slice(0,10):dateInDays(14)}"></label><label class="span-2">내부 사진 추가<input id="listingPhotoFiles" name="listing_photo_files" type="file" accept="image/*" multiple><span class="field-help">여러 장 선택 가능 · 사진 1장당 최대 10MB · 등록 후에도 사진 메뉴에서 추가/삭제 가능</span></label><label class="span-2">상세 설명<textarea name="description" rows="5">${escapeHtml(x.description||'')}</textarea></label></div>`;
  ['transaction_type','property_type','status'].forEach(n=>$('#modalBody').querySelector(`[name=${n}]`).value=x[n]||({transaction_type:'매매',property_type:'아파트',status:'available'}[n]));$('#modalBody').querySelector('[name=is_public]').value=String(x.is_public!==false);$('#modalBody').querySelector('[name=pet_allowed]').value=x.pet_allowed||'미확인';const listingLoan=$('#listingLoanAvailable');listingLoan.value=x.loan_available===true?'true':x.loan_available===false?'false':'';const toggleListingOfficial=()=>{$('#listingOfficialPriceWrap').style.display=listingLoan.value==='true'?'':'none'};listingLoan.onchange=toggleListingOfficial;toggleListingOfficial();
  $('#modalSubmit').onclick=async(e)=>{e.preventDefault();const fd=new FormData($('#modalForm'));const p=Object.fromEntries(fd.entries());p.owner_id=id?(x.owner_id||state.profile.id):state.profile.id;p.is_public=p.is_public==='true';['price','monthly_rent','management_fee','area_m2','room_count','bathroom_count'].forEach(k=>p[k]=p[k]?Number(p[k]):null);p.loan_available=p.loan_available===''?null:p.loan_available==='true';p.official_price=p.loan_available===true&&p.official_price?Number(p.official_price):null;p.move_in_negotiable=fd.get('move_in_negotiable')==='on';p.move_in_date=p.move_in_negotiable?null:(p.move_in_date||null);p.next_follow_up_at=p.next_follow_up_at||null;p.last_confirmed_at=p.last_confirmed_at||new Date().toISOString().slice(0,10);p.next_confirm_at=p.next_confirm_at||null;delete p.listing_photo_files;
    const files=$('#listingPhotoFiles')?.files;
    let listingId=id;
    if(id){const {error}=await state.client.from('listings').update(p).eq('id',id);if(error)return toast(error.message)}
    else{const {data,error}=await state.client.from('listings').insert(p).select('id').single();if(error)return toast(error.message);listingId=data.id}
    let photoResult={uploaded:0,failed:0};
    if(files?.length)photoResult=await uploadListingPhotos(listingId,files);
    $('#modal').close();
    const extra=photoResult.uploaded?` 사진 ${photoResult.uploaded}장도 등록했습니다.`:'';
    const failed=photoResult.failed?` (${photoResult.failed}장은 형식·용량 또는 권한 문제로 실패)` : '';
    toast(`저장했습니다.${extra}${failed}`);
    state.view==='adminListings'?renderAdminListings():renderMyListings()};$('#modal').showModal();
}

async function openFollowUpModal(entityType,id){
  const item=entityType==='customer'?state.customers.find(x=>x.id===id):state.listings.find(x=>x.id===id);
  if(!item)return toast('대상을 찾지 못했습니다.');
  $('#modalTitle').textContent=`${entityType==='customer'?item.name:item.title} · FU 기록`;
  $('#modalBody').innerHTML=`<div class="form-grid"><label>기록 일자<input name="follow_up_date" type="date" value="${today()}" required></label><label>상담 종류<select name="contact_method"><option>전화</option><option>대면투어</option><option>촬영</option><option>문자/톡 발송</option><option>문자/톡 수신</option><option>부재중</option><option>가계약</option><option>본계약</option><option>중도금</option><option>잔금</option><option>기타</option></select></label><label class="span-2">상담·진행 내용<textarea name="content" rows="7" placeholder="통화 내용, 고객 반응, 조건 변경, 다음 조치 등을 구체적으로 기록하세요." required></textarea></label><label>예정 FU<input name="next_follow_up_at" type="date" value="${item.next_follow_up_at?item.next_follow_up_at.slice(0,10):''}"></label></div>`;
  $('#modalSubmit').onclick=async(e)=>{e.preventDefault();const fd=new FormData($('#modalForm'));const history={created_by:state.profile.id,follow_up_date:fd.get('follow_up_date'),contact_method:fd.get('contact_method'),content:fd.get('content'),next_follow_up_at:fd.get('next_follow_up_at')||null,customer_id:entityType==='customer'?id:null,listing_id:entityType==='listing'?id:null};const {error}=await state.client.from('interaction_history').insert(history);if(error)return toast(error.message);const table=entityType==='customer'?'customers':'listings';const {error:updateError}=await state.client.from(table).update({last_follow_up_at:history.follow_up_date,next_follow_up_at:history.next_follow_up_at}).eq('id',id);if(updateError)return toast(updateError.message);$('#modal').close();toast('FU 내용이 히스토리에 저장되었습니다.');entityType==='customer'?renderCustomers():renderMyListings()};
  $('#modal').showModal();
}

async function openHistoryModal(entityType,id){
  const item=entityType==='customer'?state.customers.find(x=>x.id===id):state.listings.find(x=>x.id===id);
  const col=entityType==='customer'?'customer_id':'listing_id';
  const {data,error}=await state.client.from('interaction_history').select('*, writer:profiles!interaction_history_created_by_fkey(full_name)').eq(col,id).order('follow_up_date',{ascending:false}).order('created_at',{ascending:false});
  if(error)return toast(error.message);
  $('#modalTitle').textContent=`${entityType==='customer'?item?.name:item?.title} · FU 히스토리`;
  const contractSteps=[['가계약',item?.provisional_contract_date,false],['본계약',item?.contract_date,false],['중도금',item?.interim_payment_date,!!item?.interim_payment_not_applicable],['잔금',item?.final_payment_date,false]];
  $('#modalBody').innerHTML=`<div class="history-layout"><section><div class="contract-strip">${contractSteps.map(([n,d,na])=>`<div class="contract-step ${d?'done':''} ${na?'not-applicable':''}"><span>${n}</span><strong>${na?'해당없음':d?fmtDate(d):'미정'}</strong></div>`).join('')}</div></section><section>${(data||[]).length?`<div class="history-list">${data.map(h=>`<article class="history-item"><div class="history-head"><div><span class="history-type">${escapeHtml(h.contact_method)}</span> <strong>${fmtDate(h.follow_up_date)}</strong></div><div class="history-actions"><span class="muted">${escapeHtml(h.writer?.full_name||'')}</span>${(h.created_by===state.profile.id||state.profile.role==='admin')?`<button type="button" class="history-delete" onclick="deleteHistoryItem('${h.id}','${entityType}','${id}')">삭제</button>`:''}</div></div><p>${escapeHtml(h.content).replace(/\n/g,'<br>')}</p>${h.next_follow_up_at?`<div class="next-fu">예정 FU · ${fmtDate(h.next_follow_up_at)}</div>`:''}</article>`).join('')}</div>`:'<div class="empty">아직 기록된 상담 히스토리가 없습니다.</div>'}</section></div>`;
  $('#modalSubmit').style.display='none';
  const close=()=>{$('#modalSubmit').style.display='';$('#modal').removeEventListener('close',close)};$('#modal').addEventListener('close',close);$('#modal').showModal();
}

async function deleteHistoryItem(historyId,entityType,entityId){
  if(!confirm('이 히스토리 기록만 삭제할까요?\n계약 일정 자체는 변경되지 않습니다.'))return;
  const {error}=await state.client.from('interaction_history').delete().eq('id',historyId);
  if(error)return toast(error.message);
  const col=entityType==='customer'?'customer_id':'listing_id';
  const {data:latest}=await state.client.from('interaction_history').select('follow_up_date,next_follow_up_at').eq(col,entityId).order('follow_up_date',{ascending:false}).order('created_at',{ascending:false}).limit(1).maybeSingle();
  const table=entityType==='customer'?'customers':'listings';
  await state.client.from(table).update({last_follow_up_at:latest?.follow_up_date||null,next_follow_up_at:latest?.next_follow_up_at||null}).eq('id',entityId);
  toast('선택한 히스토리를 삭제했습니다.');
  await (entityType==='customer'?loadCustomers():loadListings());
  openHistoryModal(entityType,entityId);
}


async function openContractModal(entityType,id){
  const item=entityType==='customer'?state.customers.find(x=>x.id===id):state.listings.find(x=>x.id===id);
  if(!item)return toast('대상을 찾지 못했습니다.');
  $('#modalTitle').textContent=`${entityType==='customer'?item.name:item.title} · 계약 일정`;
  const steps=[['provisional_contract_date','가계약','provisional_contract_amount','가계약금'],['contract_date','본계약','contract_amount','계약금'],['interim_payment_date','중도금','interim_payment_amount','중도금'],['final_payment_date','잔금','final_payment_amount','잔금']];
  const demandSide=entityType==='customer'&&['매수','임차'].includes(item.customer_type);
  const supplySide=entityType==='listing'||(entityType==='customer'&&['매도','임대'].includes(item.customer_type));
  const defaultProperty=entityType==='listing'?item.title:(item.contracted_property_name||'');
  const defaultType=entityType==='listing'?item.transaction_type:(item.contracted_transaction_type||'');
  const defaultAmount=entityType==='listing'?(item.contracted_amount??item.price??''):(item.contracted_amount??'');
  const defaultMonthlyRent=entityType==='listing'?(item.contracted_monthly_rent??item.monthly_rent??''):(item.contracted_monthly_rent??'');
  const detailFields=demandSide?`
    <div class="contract-detail-grid">
      <label>계약 매물명<input name="contracted_property_name" value="${escapeHtml(defaultProperty)}" placeholder="예: 철산자이 101동 1203호"></label>
      <label>거래유형<select name="contracted_transaction_type"><option value="">선택</option><option>매매</option><option>전세</option><option>월세</option></select></label>
      <label id="contractAmountLabel">거래금액/보증금(만원)<input name="contracted_amount" type="number" value="${defaultAmount}"></label><label id="contractMonthlyRentWrap">월세(만원)<input name="contracted_monthly_rent" type="number" min="0" value="${defaultMonthlyRent}"></label>
      <label>매도/임대측 연락처<input name="counterparty_phone" value="${escapeHtml(item.counterparty_phone||'')}" placeholder="010-0000-0000"></label>
    </div>`:`
    <div class="contract-detail-grid">
      ${entityType==='listing'?`<label>계약 매물명<input name="contracted_property_name" value="${escapeHtml(defaultProperty)}"></label><label>거래유형<select name="contracted_transaction_type"><option value="">선택</option><option>매매</option><option>전세</option><option>월세</option></select></label>`:''}
      <label id="contractAmountLabel">거래금액/보증금(만원)<input name="contracted_amount" type="number" value="${defaultAmount}"></label><label id="contractMonthlyRentWrap">월세(만원)<input name="contracted_monthly_rent" type="number" min="0" value="${defaultMonthlyRent}"></label>
      <label>거래 고객명<input name="counterparty_name" value="${escapeHtml(item.counterparty_name||'')}" placeholder="매수인 또는 임차인 이름"></label>
      <label>매수/임차측 연락처<input name="counterparty_phone" value="${escapeHtml(item.counterparty_phone||'')}" placeholder="010-0000-0000"></label>
    </div>`;
  $('#modalBody').innerHTML=`<div class="contract-editor"><p class="muted">계약 상대방 정보와 일정을 함께 기록하세요. 저장된 내용은 히스토리에 자동으로 남습니다.</p><section class="contract-detail-box"><h4>계약 정보</h4>${detailFields}</section>${steps.map(([key,label,amountKey,amountLabel],i)=>{const isInterim=key==='interim_payment_date',na=isInterim&&item.interim_payment_not_applicable;return `<div class="contract-edit-row ${na?'not-applicable':''}" data-contract-row="${key}"><div class="step-no">${i+1}</div><label class="check-label"><input type="checkbox" data-stage-check="${key}" ${item[key]?'checked':''} ${na?'disabled':''}> ${label}</label><input type="date" name="${key}" value="${item[key]||''}" ${item[key]&&!na?'':'disabled'}><label class="stage-amount-label">${amountLabel}(만원)<input type="number" min="0" step="1" name="${amountKey}" value="${item[amountKey]??''}" ${item[key]&&!na?'':'disabled'} placeholder="금액"></label>${isInterim?`<label class="na-label"><input type="checkbox" id="interimNotApplicable" ${na?'checked':''}> 해당없음</label>`:''}</div>`}).join('')}</div>`;
  const typeSelect=$('#modalBody [name=contracted_transaction_type]');if(typeSelect)typeSelect.value=defaultType||'';const contractMonthlyWrap=$('#contractMonthlyRentWrap'),contractAmountLabel=$('#contractAmountLabel');const syncContractMonthly=()=>{const isMonthly=typeSelect?.value==='월세';if(contractMonthlyWrap){contractMonthlyWrap.style.display=isMonthly?'':'none';if(!isMonthly)contractMonthlyWrap.querySelector('input').value=''}if(contractAmountLabel)contractAmountLabel.firstChild.textContent=isMonthly?'보증금(만원)':'거래금액(만원)'};if(typeSelect)typeSelect.onchange=syncContractMonthly;syncContractMonthly();
  const syncInterim=()=>{
    const na=$('#interimNotApplicable')?.checked||false;
    const row=$('[data-contract-row="interim_payment_date"]');
    const check=$('[data-stage-check="interim_payment_date"]');
    const input=$('#modalBody [name=interim_payment_date]');
    const amount=$('#modalBody [name=interim_payment_amount]');
    row?.classList.toggle('not-applicable',na);
    if(check){check.disabled=na;if(na)check.checked=false}
    if(input){if(na)input.value='';input.disabled=na||!check?.checked}
    if(amount){if(na)amount.value='';amount.disabled=na||!check?.checked}
  };
  $$('[data-stage-check]').forEach(ch=>ch.onchange=()=>{const input=$(`#modalBody [name=${ch.dataset.stageCheck}]`);const step=steps.find(x=>x[0]===ch.dataset.stageCheck);const amount=step?$('#modalBody [name='+step[2]+']'):null;input.disabled=!ch.checked;if(amount)amount.disabled=!ch.checked;if(ch.checked&&!input.value)input.value=today();if(!ch.checked){input.value='';if(amount)amount.value=''}});
  if($('#interimNotApplicable'))$('#interimNotApplicable').onchange=syncInterim;
  syncInterim();
  $('#modalSubmit').onclick=async(e)=>{
    e.preventDefault();
    const fd=new FormData($('#modalForm')),payload={};
    steps.forEach(([key,,amountKey])=>{payload[key]=fd.get(key)||null;payload[amountKey]=fd.get(amountKey)?Number(fd.get(amountKey)):null});
    payload.interim_payment_not_applicable=$('#interimNotApplicable')?.checked||false;
    if(payload.interim_payment_not_applicable){payload.interim_payment_date=null;payload.interim_payment_amount=null;}
    payload.contracted_property_name=fd.get('contracted_property_name')||null;
    payload.contracted_transaction_type=fd.get('contracted_transaction_type')||null;
    payload.contracted_amount=fd.get('contracted_amount')?Number(fd.get('contracted_amount')):null;
    payload.contracted_monthly_rent=payload.contracted_transaction_type==='월세'&&fd.get('contracted_monthly_rent')?Number(fd.get('contracted_monthly_rent')):null;
    payload.counterparty_name=fd.get('counterparty_name')||null;
    payload.counterparty_phone=fd.get('counterparty_phone')||null;
    const table=entityType==='customer'?'customers':'listings';
    const {error}=await state.client.from(table).update(payload).eq('id',id);
    if(error)return toast(error.message);
    const histories=[];
    const target={customer_id:entityType==='customer'?id:null,listing_id:entityType==='listing'?id:null};
    const detail=contractDetailText({...item,...payload},entityType);
    for(const [key,label,amountKey,amountLabel] of steps){
      const before=item[key]||null,after=payload[key]||null;
      const beforeAmount=item[amountKey]??null,afterAmount=payload[amountKey]??null;
      if(after&&(after!==before||String(afterAmount??'')!==String(beforeAmount??''))){
        const paymentText=afterAmount!==null?` ${amountLabel} ${Number(afterAmount).toLocaleString('ko-KR')}만원 입금함.`:'';
        histories.push({...target,created_by:state.profile.id,follow_up_date:after,contact_method:label,content:`${label} 진행함. 날짜 ${fmtDate(after)}.${paymentText}${detail?`\n${detail}`:''}`,next_follow_up_at:null});
      }
    }
    const detailKeys=['contracted_property_name','contracted_transaction_type','contracted_amount','contracted_monthly_rent','counterparty_name','counterparty_phone'];
    const detailChanged=detailKeys.some(k=>String(item[k]??'')!==String(payload[k]??''));
    if(detailChanged&&detail)histories.push({...target,created_by:state.profile.id,follow_up_date:today(),contact_method:'계약정보',content:`계약 정보 등록/변경함.\n${detail}`,next_follow_up_at:null});
    if(histories.length){const {error:hErr}=await state.client.from('interaction_history').insert(histories);if(hErr)return toast(`계약 일정은 저장됐지만 히스토리 기록 실패: ${hErr.message}`)}
    $('#modal').close();toast('계약 정보·일정과 히스토리를 저장했습니다.');entityType==='customer'?renderCustomers():(state.view==='adminListings'?renderAdminListings():renderMyListings());
  };
  $('#modal').showModal();
}


async function openListingPhotos(id){
  const listing=state.listings.find(x=>x.id===id);
  if(!listing)return toast('매물을 찾을 수 없습니다.');
  $('#modalTitle').textContent=`내부 사진 · ${listing.title}`;
  $('#modalSubmit').classList.add('hidden');
  $('#modalBody').innerHTML='<div class="photo-loading">사진을 불러오는 중입니다.</div>';
  $('#modal').showModal();
  await renderListingPhotoGallery(listing);
  const cleanup=()=>$('#modalSubmit').classList.remove('hidden');
  $('#modal').addEventListener('close',cleanup,{once:true});
}
async function renderListingPhotoGallery(listing){
  const {data,error}=await state.client.from('listing_photos').select('*').eq('listing_id',listing.id).order('sort_order',{ascending:true}).order('created_at',{ascending:true});
  if(error){$('#modalBody').innerHTML=`<div class="empty">${escapeHtml(error.message)}</div>`;return}
  const photos=data||[];
  const urls=await Promise.all(photos.map(p=>signedPhotoUrl(p.storage_path)));
  const manageable=canManageListing(listing);
  $('#modalBody').innerHTML=`${photos.length?`<div class="photo-download-bar"><button type="button" class="success" id="downloadAllPhotosBtn" onclick="downloadAllListingPhotos('${listing.id}')">사진 전체 다운로드 (.zip)</button><span class="field-help">등록된 사진 ${photos.length}장을 한 번에 압축해서 받습니다.</span></div>`:''}${manageable?`<div class="photo-upload-panel"><label>사진 추가<input id="galleryPhotoFiles" type="file" accept="image/*" multiple></label><button type="button" class="primary" onclick="addListingPhotos('${listing.id}')">선택한 사진 업로드</button><span class="field-help">여러 장 선택 가능 · 1장당 최대 10MB</span></div>`:''}<div class="photo-gallery">${photos.length?photos.map((p,i)=>`<figure class="photo-card">${urls[i]?`<a href="${escapeHtml(urls[i])}" target="_blank" rel="noopener"><img src="${escapeHtml(urls[i])}" alt="${escapeHtml(p.file_name||'매물 내부 사진')}" loading="lazy"></a>`:'<div class="photo-error">사진 URL 오류</div>'}<figcaption><span>${escapeHtml(p.file_name||'사진')}</span>${manageable?`<button type="button" class="danger small" onclick="deleteListingPhoto('${listing.id}','${p.id}','${escapeHtml(p.storage_path)}')">삭제</button>`:''}</figcaption></figure>`).join(''):'<div class="empty photo-empty">등록된 내부 사진이 없습니다.</div>'}</div>`;
}

async function downloadAllListingPhotos(listingId){
  const listing=state.listings.find(x=>x.id===listingId);
  if(!listing)return toast('매물을 찾을 수 없습니다.');
  if(typeof JSZip==='undefined')return toast('압축 기능을 불러오지 못했습니다. 인터넷 연결 후 다시 시도하세요.');
  const btn=$('#downloadAllPhotosBtn');
  const original=btn?.textContent||'사진 전체 다운로드 (.zip)';
  if(btn){btn.disabled=true;btn.textContent='사진 목록 확인 중...'}
  try{
    const {data,error}=await state.client.from('listing_photos').select('*').eq('listing_id',listingId).order('sort_order',{ascending:true}).order('created_at',{ascending:true});
    if(error)throw error;
    const photos=data||[];
    if(!photos.length){toast('다운로드할 사진이 없습니다.');return}
    const zip=new JSZip();
    const used=new Set();
    let success=0,failed=0;
    for(let i=0;i<photos.length;i++){
      if(btn)btn.textContent=`사진 다운로드 중 ${i+1}/${photos.length}`;
      const photo=photos[i];
      try{
        const url=await signedPhotoUrl(photo.storage_path);
        if(!url)throw new Error('사진 URL 생성 실패');
        const res=await fetch(url);
        if(!res.ok)throw new Error(`HTTP ${res.status}`);
        const blob=await res.blob();
        let name=(photo.file_name||`사진_${i+1}.jpg`).replace(/[\/:*?"<>|]/g,'_');
        if(used.has(name)){
          const dot=name.lastIndexOf('.');
          const base=dot>0?name.slice(0,dot):name;
          const ext=dot>0?name.slice(dot):'';
          let n=2;while(used.has(`${base}_${n}${ext}`))n++;
          name=`${base}_${n}${ext}`;
        }
        used.add(name);zip.file(name,blob);success++;
      }catch(e){failed++;console.error('사진 다운로드 실패',photo,e)}
    }
    if(!success)throw new Error('다운로드 가능한 사진이 없습니다.');
    if(btn)btn.textContent='압축파일 만드는 중...';
    const out=await zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:6}});
    const safeTitle=(listing.title||'매물사진').replace(/[\/:*?"<>|]/g,'_').trim()||'매물사진';
    const a=document.createElement('a');a.href=URL.createObjectURL(out);a.download=`${safeTitle}_내부사진_${today()}.zip`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),3000);
    toast(`사진 ${success}장을 다운로드했습니다.${failed?` ${failed}장은 실패했습니다.`:''}`);
  }catch(e){toast(`전체 다운로드 실패: ${e.message||e}`)}
  finally{if(btn){btn.disabled=false;btn.textContent=original}}
}

async function addListingPhotos(listingId){
  const listing=state.listings.find(x=>x.id===listingId);if(!canManageListing(listing))return toast('사진을 추가할 권한이 없습니다.');
  const files=$('#galleryPhotoFiles')?.files;if(!files?.length)return toast('업로드할 사진을 선택하세요.');
  const result=await uploadListingPhotos(listingId,files);
  toast(`사진 ${result.uploaded}장 업로드${result.failed?`, ${result.failed}장 실패`:''}`);
  await renderListingPhotoGallery(listing);
}
async function deleteListingPhoto(listingId,photoId,path){
  const listing=state.listings.find(x=>x.id===listingId);if(!canManageListing(listing))return toast('사진을 삭제할 권한이 없습니다.');
  if(!confirm('이 사진을 삭제할까요?'))return;
  const {error:storageError}=await state.client.storage.from('listing-photos').remove([path]);
  if(storageError)return toast(storageError.message);
  const {error}=await state.client.from('listing_photos').delete().eq('id',photoId);
  if(error)return toast(error.message);
  toast('사진을 삭제했습니다.');await renderListingPhotoGallery(listing);
}

async function deleteListing(id){
  if(!confirm('매물을 삭제할까요? 등록된 내부 사진도 함께 삭제됩니다.'))return;
  const {data:photos}=await state.client.from('listing_photos').select('storage_path').eq('listing_id',id);
  const paths=(photos||[]).map(x=>x.storage_path);
  if(paths.length){const {error:photoError}=await state.client.storage.from('listing-photos').remove(paths);if(photoError)return toast(`사진 삭제 실패: ${photoError.message}`)}
  const {error}=await state.client.from('listings').delete().eq('id',id);if(error)return toast(error.message);
  toast('매물과 내부 사진을 삭제했습니다.');state.view==='adminListings'?renderAdminListings():renderMyListings()
}


function toggleAdminListingSelection(id,checked){
  checked?state.adminSelectedListings.add(id):state.adminSelectedListings.delete(id);
  updateBulkTransferControls();
}
function toggleAllAdminListings(checked){
  $$('.admin-listing-check').forEach(el=>{el.checked=checked;checked?state.adminSelectedListings.add(el.value):state.adminSelectedListings.delete(el.value)});
  updateBulkTransferControls();
}
function updateBulkTransferControls(){
  const count=state.adminSelectedListings.size;
  ['#bulkTransferBtn','#bulkTransferTopBtn'].forEach(sel=>{const b=$(sel);if(b){b.disabled=count===0;b.textContent=`선택 매물 일괄 이관 (${count})`}});
  const checks=$$('.admin-listing-check'),all=$('#selectAllAdminListings');
  if(all){all.checked=checks.length>0&&checks.every(x=>x.checked);all.indeterminate=checks.some(x=>x.checked)&&!checks.every(x=>x.checked)}
}
async function openBulkListingTransfer(){
  if(state.profile.role!=='admin')return toast('관리자만 이관할 수 있습니다.');
  const ids=[...state.adminSelectedListings];
  if(!ids.length)return toast('이관할 매물을 먼저 선택하세요.');
  await loadMembers();
  const selected=state.listings.filter(x=>ids.includes(x.id));
  const approved=state.members.filter(x=>x.status==='approved');
  $('#modalTitle').textContent='선택 매물 일괄 이관';
  $('#modalBody').innerHTML=`<div class="notice"><strong>${selected.length}개 매물</strong>을 한 번에 이관합니다.<br><span class="muted">공개·비공개 매물이 함께 선택되어 있어도 모두 이관됩니다.</span></div><div class="bulk-transfer-list">${selected.slice(0,20).map(x=>`<div><strong>${escapeHtml(x.title)}</strong><span>${escapeHtml(x.owner?.full_name||'-')} · ${x.is_public?'공개':'비공개'}</span></div>`).join('')}${selected.length>20?`<div class="muted">외 ${selected.length-20}개</div>`:''}</div><div class="form-grid" style="margin-top:16px"><label>새 담당 중개사<select id="bulkTransferTo" required><option value="">선택</option>${approved.map(x=>`<option value="${x.id}">${escapeHtml(x.full_name)} · ${escapeHtml(x.office_name||'')}</option>`).join('')}</select></label><label>이관 사유<input id="bulkTransferReason" value="관리자 선택 매물 일괄 이관"></label></div><div id="bulkTransferProgress" class="muted" style="margin-top:12px"></div>`;
  $('#modalSubmit').onclick=async(e)=>{
    e.preventDefault();
    const to=$('#bulkTransferTo').value,reason=$('#bulkTransferReason').value.trim();
    if(!to)return toast('새 담당 중개사를 선택하세요.');
    if(!confirm(`선택한 ${ids.length}개 매물을 이관할까요?`))return;
    const btn=$('#modalSubmit');btn.disabled=true;let success=0,failed=0;
    for(let i=0;i<ids.length;i++){
      $('#bulkTransferProgress').textContent=`이관 처리 중 ${i+1}/${ids.length}`;
      const {error}=await state.client.rpc('transfer_single_listing',{p_listing:ids[i],p_to:to,p_reason:reason});
      error?failed++:success++;
    }
    btn.disabled=false;$('#modal').close();state.adminSelectedListings.clear();
    toast(`일괄 이관 완료: 성공 ${success}개${failed?`, 실패 ${failed}개`:''}`);
    await renderAdminListings();
  };
  $('#modal').showModal();
}

async function openSingleListingTransfer(id){
  if(state.profile.role!=='admin')return toast('관리자만 이관할 수 있습니다.');
  await loadMembers();
  const listing=state.listings.find(x=>x.id===id);
  if(!listing)return toast('매물을 찾을 수 없습니다.');
  const approved=state.members.filter(x=>x.status==='approved'&&x.id!==listing.owner_id);
  $('#modalTitle').textContent='매물 개별 이관';
  $('#modalBody').innerHTML=`<div class="notice"><strong>${escapeHtml(listing.title)}</strong><br>현재 담당자: ${escapeHtml(listing.owner?.full_name||'-')} · ${listing.is_public?'공개':'비공개'}</div><div class="form-grid" style="margin-top:16px"><label>새 담당 중개사<select id="singleTransferTo" required><option value="">선택</option>${approved.map(x=>`<option value="${x.id}">${escapeHtml(x.full_name)} · ${escapeHtml(x.office_name||'')}</option>`).join('')}</select></label><label>이관 사유<input id="singleTransferReason" value="관리자 매물 개별 이관"></label></div>`;
  $('#modalSubmit').onclick=async(e)=>{e.preventDefault();const to=$('#singleTransferTo').value,reason=$('#singleTransferReason').value.trim();if(!to)return toast('새 담당 중개사를 선택하세요.');if(!confirm('이 매물을 선택한 중개사에게 이관할까요?'))return;const {error}=await state.client.rpc('transfer_single_listing',{p_listing:id,p_to:to,p_reason:reason});if(error)return toast(error.message);$('#modal').close();toast('매물 담당자를 이관했습니다.');await renderAdminListings();};
  $('#modal').showModal();
}

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
$$('#modal [value="cancel"]').forEach(btn=>{btn.type='button';btn.onclick=()=>$('#modal').close('cancel')});
window.renderView=renderView;window.openContractModal=openContractModal;window.openFollowUpModal=openFollowUpModal;window.openHistoryModal=openHistoryModal;window.filterCustomers=filterCustomers;window.openCustomerModal=openCustomerModal;window.deleteCustomer=deleteCustomer;window.openListingModal=openListingModal;window.deleteListing=deleteListing;window.filterNetwork=filterNetwork;window.filterAdminListings=filterAdminListings;window.openSingleListingTransfer=openSingleListingTransfer;window.setMemberStatus=setMemberStatus;window.previewTransfer=previewTransfer;window.executeTransfer=executeTransfer;
boot();

/* ================= CRM v3.0 통합업무기능 ================= */
state.selectedCustomers = new Set();
state.matchSelection = new Set();

function daysFromToday(dateValue){
  if(!dateValue)return null;
  return Math.floor((new Date(dateValue+'T00:00:00')-new Date(today()+'T00:00:00'))/86400000);
}
function dateInDays(days){const d=new Date();d.setDate(d.getDate()+days);return d.toISOString().slice(0,10)}
function includesMonthly(type=''){return String(type).includes('월세')}
function normalizeText(v=''){return String(v||'').trim().toLowerCase()}
function downloadBlob(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},800)}
function moneyNumber(v){const n=Number(v);return Number.isFinite(n)?n:0}

const v300OriginalRenderView=renderView;
renderView=async function(view){
  const custom={smartMatch:renderSmartMatch,globalSearch:renderGlobalSearch,documents:renderDocuments,adminStats:renderAdminStats,auditLogs:renderAuditLogs,customerTransfer:renderCustomerTransfer,adminData:renderAdminData};
  if(custom[view]){
    state.view=view;$$('.nav').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
    const titles={smartMatch:['고객·매물 자동매칭','거래유형·지역·방 개수·금액 조건을 충족하는 매물만 추천'],globalSearch:['통합검색','고객·매물·연락처·주소·메모를 한 번에 검색'],documents:['계약서류','계약 관련 파일을 담당자와 관리자만 관리'],adminStats:['중개사 업무 통계','중개사별 고객·매물·계약·FU 현황'],auditLogs:['변경 기록','고객과 매물의 등록·수정·삭제 이력'],customerTransfer:['고객 선택 일괄 이관','여러 고객을 체크해 한 번에 담당자 변경'],adminData:['엑셀 데이터 관리','관리자만 고객·매물 엑셀 가져오기와 내보내기 가능']};
    $('#pageTitle').textContent=titles[view][0];$('#pageSubtitle').textContent=titles[view][1];$('#topActions').innerHTML='';
    await custom[view]();return;
  }
  await v300OriginalRenderView(view);
};

const v300OriginalDashboard=renderDashboard;
renderDashboard=async function(){
  await v300OriginalDashboard();
  const now=today();
  const customerDue=state.customers.filter(x=>x.next_follow_up_at&&x.next_follow_up_at<=now);
  const listingDue=state.listings.filter(x=>x.next_follow_up_at&&x.next_follow_up_at<=now);
  const stale=state.listings.filter(x=>{const base=x.next_confirm_at||x.last_confirmed_at;return base&&base<=now&&x.status!=='complete'});
  const payments=[];
  [...state.customers,...state.listings].forEach(x=>[['가계약',x.provisional_contract_date],['본계약',x.contract_date],['중도금',x.interim_payment_date],['잔금',x.final_payment_date]].forEach(([label,d])=>{if(d&&d>=now&&d<=dateInDays(7))payments.push({label,date:d,name:x.name||x.title})}));
  const extra=document.createElement('div');extra.className='v300-dashboard';
  extra.innerHTML=`<div class="grid stats" style="margin-top:16px"><div class="card stat alert-card"><div class="label">오늘·지연 고객 FU</div><div class="value">${customerDue.length}</div></div><div class="card stat alert-card"><div class="label">오늘·지연 매물 FU</div><div class="value">${listingDue.length}</div></div><div class="card stat alert-card"><div class="label">확인 필요 매물</div><div class="value">${stale.length}</div></div><div class="card stat alert-card"><div class="label">7일 내 계약금·잔금</div><div class="value">${payments.length}</div></div></div><div class="split" style="margin-top:16px"><div class="panel"><div class="panel-head"><h3>오늘 처리할 FU</h3></div>${[...customerDue.map(x=>({name:x.name,type:'고객',date:x.next_follow_up_at})),...listingDue.map(x=>({name:x.title,type:'매물',date:x.next_follow_up_at}))].slice(0,10).map(x=>`<div class="list-item"><div><strong>${escapeHtml(x.name)}</strong><div class="muted">${x.type}</div></div>${dueBadge(x.date)}</div>`).join('')||'<div class="empty">오늘 처리할 FU가 없습니다.</div>'}</div><div class="panel"><div class="panel-head"><h3>예정 계약 일정</h3></div>${payments.sort((a,b)=>a.date.localeCompare(b.date)).slice(0,10).map(x=>`<div class="list-item"><div><strong>${escapeHtml(x.name)}</strong><div class="muted">${x.label}</div></div>${dueBadge(x.date)}</div>`).join('')||'<div class="empty">7일 내 일정이 없습니다.</div>'}</div></div>`;
  $('#content').appendChild(extra);
};

function customerDealTypes(customer){
  return String(customer.deal_type||'').split('+').map(x=>x.trim()).filter(Boolean);
}
function areaMatches(customer,listing){
  const area=normalizeText(customer.preferred_area);
  if(!area)return true;
  const addr=normalizeText(`${listing.district||''} ${listing.address||''}`);
  const tokens=area.split(/[,/\s]+/).filter(Boolean);
  return tokens.some(token=>addr.includes(token));
}
function roomMatches(customer,listing){
  const wanted=moneyNumber(customer.desired_rooms);
  if(!wanted)return true;
  return moneyNumber(listing.room_count)>=wanted;
}
function jeonseEquivalent(listing){
  // 실무상 빠른 비교를 위한 단순 환산: 보증금 + 월세 × 100
  return moneyNumber(listing.price)+(moneyNumber(listing.monthly_rent)*100);
}
function evaluateListingMatch(customer,listing){
  const customerTypes=customerDealTypes(customer);
  const budget=moneyNumber(customer.budget_max);
  const wantedRent=moneyNumber(customer.desired_monthly_rent);
  const reasons=[];

  if(!areaMatches(customer,listing))return {matched:false,reasons:['희망지역 불일치']};
  if(customer.preferred_area)reasons.push(`희망지역 일치: ${customer.preferred_area}`);

  if(!roomMatches(customer,listing))return {matched:false,reasons:[`방 개수 부족: 희망 ${customer.desired_rooms}개 / 매물 ${listing.room_count??0}개`]};
  if(customer.desired_rooms)reasons.push(`방 개수 충족: 희망 ${customer.desired_rooms}개 / 매물 ${listing.room_count??'-'}개`);

  // 매매 고객
  if(customerTypes.includes('매매')&&listing.transaction_type==='매매'){
    if(budget&&moneyNumber(listing.price)>budget)return {matched:false,reasons:['매매 예산 초과']};
    reasons.push(`매매 금액 충족: ${fmtMoney(listing.price)}${budget?` ≤ ${fmtMoney(budget)}`:''}`);
    return {matched:true,category:'매매',reasons};
  }

  // 전세 고객: 전세는 희망금액보다 5,000만원 높은 매물까지, 월세는 전세환산액으로 비교
  if(customerTypes.includes('전세')){
    const ceiling=budget?budget+5000:0;
    if(listing.transaction_type==='전세'){
      if(ceiling&&moneyNumber(listing.price)>ceiling)return {matched:false,reasons:['전세 허용금액 초과']};
      reasons.push(`전세금 조건 충족: ${fmtMoney(listing.price)}${budget?` / 기준 ${fmtMoney(budget)} + 허용 5,000만원`:''}`);
      return {matched:true,category:'전세',reasons};
    }
    if(listing.transaction_type==='월세'){
      const equivalent=jeonseEquivalent(listing);
      if(ceiling&&equivalent>ceiling)return {matched:false,reasons:['월세 전세환산액 초과']};
      reasons.push(`월세 매물 전세환산 충족: 보증금 ${fmtMoney(listing.price)} + 월세 ${fmtMoney(listing.monthly_rent)}×100 = ${fmtMoney(equivalent)}`);
      if(budget)reasons.push(`전세 기준 ${fmtMoney(budget)}에서 +5,000만원 범위 이내`);
      return {matched:true,category:'전세환산 월세',reasons};
    }
  }

  // 월세 고객: 보증금은 희망 보증금 이내, 월차임은 희망 월세의 130% 이내
  if(customerTypes.includes('월세')&&listing.transaction_type==='월세'){
    if(budget&&moneyNumber(listing.price)>budget)return {matched:false,reasons:['월세 보증금 초과']};
    const rentLimit=wantedRent?wantedRent*1.3:0;
    if(rentLimit&&moneyNumber(listing.monthly_rent)>rentLimit)return {matched:false,reasons:['월차임 130% 한도 초과']};
    reasons.push(`보증금 충족: ${fmtMoney(listing.price)}${budget?` ≤ ${fmtMoney(budget)}`:''}`);
    reasons.push(`월차임 충족: ${fmtMoney(listing.monthly_rent)}${wantedRent?` ≤ 희망 ${fmtMoney(wantedRent)}의 130% (${fmtMoney(Math.round(rentLimit))})`:''}`);
    return {matched:true,category:'월세',reasons};
  }

  return {matched:false,reasons:['거래유형 불일치']};
}
async function renderSmartMatch(){
  await Promise.all([loadCustomers(),loadListings()]);
  const demand=state.customers.filter(x=>['매수','임차'].includes(x.customer_type));
  $('#content').innerHTML=`<div class="panel"><div class="notice"><strong>추천 기준</strong><br>지역과 방 개수를 충족한 매물 중 거래유형별 금액 규칙을 적용합니다. 전세 고객에게 월세 매물을 추천할 때는 <b>보증금 + 월세×100</b>으로 전세환산합니다. 추천 사유는 로그인한 중개사 화면에서만 표시되며 고객용 소개서에는 포함되지 않습니다.</div><div class="filters" style="margin-top:16px"><select id="matchCustomer" onchange="showCustomerMatches()"><option value="">고객 선택</option>${demand.map(x=>`<option value="${x.id}">${escapeHtml(x.name)} · ${escapeHtml(x.deal_type||x.customer_type)} · ${escapeHtml(x.preferred_area||'지역미정')}</option>`).join('')}</select><button class="ghost" onclick="renderView('customers')">고객 관리</button></div><div id="matchResults" class="empty">고객을 선택하면 조건을 충족하는 공개 매물만 추천합니다.</div></div>`;
}
async function showCustomerMatches(){
  const customer=state.customers.find(x=>x.id===$('#matchCustomer').value);if(!customer)return;
  state.matchSelection.clear();
  const rows=state.listings.filter(x=>x.is_public&&x.status==='available').map(x=>({...x,_match:evaluateListingMatch(customer,x)})).filter(x=>x._match.matched).sort((a,b)=>{
    const roomA=moneyNumber(a.room_count)-moneyNumber(customer.desired_rooms),roomB=moneyNumber(b.room_count)-moneyNumber(customer.desired_rooms);
    if(roomA!==roomB)return roomA-roomB;
    return moneyNumber(a.price)-moneyNumber(b.price);
  });
  $('#matchResults').innerHTML=`<div class="match-toolbar"><strong>${escapeHtml(customer.name)} 조건 충족 매물 ${rows.length}개</strong><button class="primary" onclick="printSelectedListingBrochure('${customer.id}')">선택 매물 소개서 인쇄/PDF</button></div>${rows.length?`<div class="match-grid">${rows.map(x=>`<article class="match-card"><label class="check-label"><input type="checkbox" onchange="toggleMatchSelection('${x.id}',this.checked)"> 소개서 선택</label><div class="match-type">${escapeHtml(x._match.category)}</div><h3>${escapeHtml(x.title)}</h3><div class="match-reason"><strong>중개사 추천 사유</strong>${x._match.reasons.map(r=>`<div>• ${escapeHtml(r)}</div>`).join('')}</div><p>${escapeHtml(x.district||'')} · ${escapeHtml(x.transaction_type)} · ${listingPriceText(x)}</p><p>방 ${x.room_count??'-'} / 욕실 ${x.bathroom_count??'-'}</p><button class="ghost" onclick="openListingPhotos('${x.id}')">사진 보기</button></article>`).join('')}</div>`:'<div class="empty">현재 조건을 모두 충족하는 공개 매물이 없습니다.</div>'}`;
}
function toggleMatchSelection(id,checked){checked?state.matchSelection.add(id):state.matchSelection.delete(id)}
async function printSelectedListingBrochure(customerId){
  const customer=state.customers.find(x=>x.id===customerId),rows=state.listings.filter(x=>state.matchSelection.has(x.id));if(!rows.length)return toast('소개서에 넣을 매물을 선택하세요.');
  const w=window.open('','_blank');
  const cards=[];for(const x of rows){const {data:photos}=await state.client.from('listing_photos').select('*').eq('listing_id',x.id).eq('is_customer_visible',true).order('sort_order');let image='';const cover=(photos||[]).find(p=>p.id===x.cover_photo_id)||(photos||[])[0];if(cover)image=await signedPhotoUrl(cover.storage_path)||'';cards.push(`<section class="property">${image?`<img src="${image}">`:''}<h2>${escapeHtml(x.title)}</h2><p><b>${escapeHtml(x.transaction_type)}</b> ${listingPriceText(x)}</p><p>${escapeHtml(x.district||'')} ${escapeHtml(x.address||'')}</p><p>면적 ${x.area_m2||'-'}㎡ · 방 ${x.room_count??'-'} · 욕실 ${x.bathroom_count??'-'}</p><p>${escapeHtml(x.description||'')}</p></section>`)}
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(customer.name)} 매물소개서</title><style>body{font-family:Arial,'Noto Sans KR',sans-serif;max-width:900px;margin:auto;padding:30px}.property{page-break-inside:avoid;border-bottom:2px solid #ddd;padding:24px 0}.property img{width:100%;max-height:420px;object-fit:cover;border-radius:12px}header{border-bottom:3px solid #111}small{color:#666}</style></head><body><header><h1>${escapeHtml(customer.name)} 고객님 추천 매물</h1><small>소유자 연락처와 내부 메모는 제외된 고객용 자료입니다.</small></header>${cards.join('')}<script>setTimeout(()=>window.print(),700)<\/script></body></html>`);w.document.close();
}

async function renderGlobalSearch(){
  await Promise.all([loadCustomers(),loadListings()]);
  $('#content').innerHTML=`<div class="panel"><div class="global-search"><input id="globalSearchInput" placeholder="고객명·전화번호·매물명·주소·소유자 연락처·메모 검색" oninput="runGlobalSearch()"><button class="primary" onclick="runGlobalSearch()">검색</button></div><div id="globalSearchResults" class="empty">검색어를 입력하세요.</div></div>`;
}
function runGlobalSearch(){const q=normalizeText($('#globalSearchInput').value);if(!q){$('#globalSearchResults').innerHTML='<div class="empty">검색어를 입력하세요.</div>';return}const customers=state.customers.filter(x=>normalizeText(`${x.name} ${x.phone} ${x.preferred_area} ${x.notes}`).includes(q));const listings=state.listings.filter(x=>normalizeText(`${x.title} ${x.address} ${x.district} ${x.contact_phone} ${x.description} ${x.owner?.full_name}`).includes(q));$('#globalSearchResults').innerHTML=`<div class="split"><div><h3>고객 ${customers.length}명</h3>${customers.map(x=>`<div class="search-result"><strong>${escapeHtml(x.name)}</strong><span>${escapeHtml(x.phone||'')} · ${escapeHtml(x.preferred_area||'')}</span><button onclick="openCustomerModal('${x.id}')">열기</button></div>`).join('')||'<div class="empty">결과 없음</div>'}</div><div><h3>매물 ${listings.length}개</h3>${listings.map(x=>`<div class="search-result"><strong>${escapeHtml(x.title)}</strong><span>${escapeHtml(x.address||'')} · ${listingPriceText(x)}</span><button onclick="openListingModal('${x.id}')">열기</button></div>`).join('')||'<div class="empty">결과 없음</div>'}</div></div>`}

async function renderAdminStats(){
  await Promise.all([loadMembers(),loadCustomers(),loadListings()]);
  if(state.profile.role!=='admin')return toast('관리자 전용 기능입니다.');
  const rows=state.members.filter(x=>x.status==='approved').map(m=>{const cs=state.customers.filter(x=>x.owner_id===m.id),ls=state.listings.filter(x=>x.owner_id===m.id);return {m,customers:cs.length,listings:ls.length,public:ls.filter(x=>x.is_public).length,contracts:[...cs,...ls].filter(x=>x.contract_date||x.final_payment_date).length,overdue:[...cs,...ls].filter(x=>x.next_follow_up_at&&x.next_follow_up_at<today()).length}});
  $('#content').innerHTML=`<div class="panel"><div class="table-wrap"><table><thead><tr><th>중개사</th><th>고객</th><th>매물</th><th>공개매물</th><th>계약진행</th><th>지연 FU</th></tr></thead><tbody>${rows.map(x=>`<tr><td><strong>${escapeHtml(x.m.full_name)}</strong><div class="muted">${escapeHtml(x.m.office_name||'')}</div></td><td>${x.customers}</td><td>${x.listings}</td><td>${x.public}</td><td>${x.contracts}</td><td>${x.overdue?badge(x.overdue,'red'):badge('0','green')}</td></tr>`).join('')}</tbody></table></div></div>`;
}

async function renderAuditLogs(){
  if(state.profile.role!=='admin')return;
  const {data,error}=await state.client.from('audit_logs').select('*, actor:profiles!audit_logs_actor_id_fkey(full_name)').order('created_at',{ascending:false}).limit(300);if(error)return toast(error.message);
  $('#content').innerHTML=`<div class="panel"><div class="filters"><input id="auditSearch" placeholder="대상·사용자 검색" oninput="filterAuditRows()"></div><div id="auditRows">${auditRowsHtml(data||[])}</div></div>`;state.auditRows=data||[];
}
function auditRowsHtml(rows){return `<div class="table-wrap"><table><thead><tr><th>일시</th><th>사용자</th><th>동작</th><th>대상</th><th>주요 변경</th></tr></thead><tbody>${rows.map(x=>{let detail='';if(x.action==='UPDATE'){const keys=Object.keys(x.after_data||{}).filter(k=>JSON.stringify(x.before_data?.[k])!==JSON.stringify(x.after_data?.[k])&&!['updated_at'].includes(k));detail=keys.slice(0,6).map(k=>`${k}: ${x.before_data?.[k]??'-'} → ${x.after_data?.[k]??'-'}`).join(' / ')}return `<tr><td>${new Date(x.created_at).toLocaleString('ko-KR')}</td><td>${escapeHtml(x.actor?.full_name||'-')}</td><td>${badge(x.action,x.action==='DELETE'?'red':x.action==='UPDATE'?'yellow':'green')}</td><td>${escapeHtml(x.entity_type)}</td><td class="audit-detail">${escapeHtml(detail||'-')}</td></tr>`}).join('')}</tbody></table></div>`}
function filterAuditRows(){const q=normalizeText($('#auditSearch').value);$('#auditRows').innerHTML=auditRowsHtml(state.auditRows.filter(x=>normalizeText(`${x.actor?.full_name} ${x.entity_type} ${x.action} ${JSON.stringify(x.after_data)}`).includes(q)))}

async function renderCustomerTransfer(){
  if(state.profile.role!=='admin')return;
  await Promise.all([loadCustomers(),loadMembers()]);state.selectedCustomers.clear();
  $('#content').innerHTML=`<div class="panel"><div class="filters"><input id="customerTransferSearch" placeholder="고객명·연락처 검색" oninput="filterCustomerTransfer()"><select id="customerTransferOwner" onchange="filterCustomerTransfer()"><option value="">전체 담당자</option>${state.members.filter(x=>x.status==='approved').map(x=>`<option value="${x.id}">${escapeHtml(x.full_name)}</option>`).join('')}</select><button id="bulkCustomerTransferBtn" class="primary" onclick="openBulkCustomerTransfer()" disabled>선택 고객 이관 (0)</button></div><div id="customerTransferTable"></div></div>`;filterCustomerTransfer();
}
function filterCustomerTransfer(){const q=normalizeText($('#customerTransferSearch')?.value),owner=$('#customerTransferOwner')?.value||'';const rows=state.customers.filter(x=>(!q||normalizeText(`${x.name} ${x.phone}`).includes(q))&&(!owner||x.owner_id===owner));$('#customerTransferTable').innerHTML=`<div class="table-wrap"><table><thead><tr><th><input type="checkbox" onchange="toggleAllTransferCustomers(this.checked)"></th><th>고객</th><th>구분</th><th>연락처</th><th>상태</th></tr></thead><tbody>${rows.map(x=>`<tr><td><input class="customer-transfer-check" data-id="${x.id}" type="checkbox" ${state.selectedCustomers.has(x.id)?'checked':''} onchange="toggleTransferCustomer('${x.id}',this.checked)"></td><td><strong>${escapeHtml(x.name)}</strong></td><td>${escapeHtml(x.customer_type)}</td><td>${escapeHtml(x.phone||'')}</td><td>${escapeHtml(x.status||'')}</td></tr>`).join('')}</tbody></table></div>`}
function toggleTransferCustomer(id,checked){checked?state.selectedCustomers.add(id):state.selectedCustomers.delete(id);$('#bulkCustomerTransferBtn').disabled=!state.selectedCustomers.size;$('#bulkCustomerTransferBtn').textContent=`선택 고객 이관 (${state.selectedCustomers.size})`}
function toggleAllTransferCustomers(checked){$$('.customer-transfer-check').forEach(x=>{x.checked=checked;toggleTransferCustomer(x.dataset.id,checked)})}
async function openBulkCustomerTransfer(){if(!state.selectedCustomers.size)return;$('#modalTitle').textContent='선택 고객 일괄 이관';$('#modalBody').innerHTML=`<p><strong>${state.selectedCustomers.size}명</strong>을 새 담당자에게 이관합니다.</p><label>새 담당자<select id="bulkCustomerTo"><option value="">선택</option>${state.members.filter(x=>x.status==='approved').map(x=>`<option value="${x.id}">${escapeHtml(x.full_name)} · ${escapeHtml(x.office_name||'')}</option>`).join('')}</select></label><label>이관 사유<input id="bulkCustomerReason" value="관리자 선택 일괄 이관"></label>`;$('#modalSubmit').style.display='';$('#modalSubmit').onclick=async e=>{e.preventDefault();const to=$('#bulkCustomerTo').value;if(!to)return toast('새 담당자를 선택하세요.');const {data,error}=await state.client.rpc('bulk_transfer_customers',{p_ids:[...state.selectedCustomers],p_to:to,p_reason:$('#bulkCustomerReason').value});if(error)return toast(error.message);$('#modal').close();toast(`${data}명의 고객을 이관했습니다.`);renderCustomerTransfer()};$('#modal').showModal()}

async function renderDocuments(){
  await Promise.all([loadCustomers(),loadListings()]);
  $('#content').innerHTML=`<div class="panel"><div class="filters"><select id="docTargetType" onchange="syncDocTargets()"><option value="customer">고객 계약</option><option value="listing">매물 계약</option></select><select id="docTarget"></select><select id="docType"><option>계약서</option><option>확인설명서</option><option>등기부등본</option><option>건축물대장</option><option>영수증</option><option>기타</option></select><input id="docFiles" type="file" multiple><button class="primary" onclick="uploadContractDocuments()">서류 업로드</button></div><div id="documentList" class="empty">대상을 선택하세요.</div></div>`;syncDocTargets();
}
function syncDocTargets(){const type=$('#docTargetType').value,rows=type==='customer'?state.customers:state.listings;$('#docTarget').innerHTML='<option value="">대상 선택</option>'+rows.map(x=>`<option value="${x.id}">${escapeHtml(x.name||x.title)}</option>`).join('');$('#docTarget').onchange=loadContractDocuments}
async function uploadContractDocuments(){const type=$('#docTargetType').value,id=$('#docTarget').value,files=[...$('#docFiles').files];if(!id||!files.length)return toast('대상과 파일을 선택하세요.');let ok=0;for(const f of files){if(f.size>20*1024*1024)continue;const path=`${type}/${id}/${crypto.randomUUID()}-${f.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;const {error:u}=await state.client.storage.from('contract-documents').upload(path,f);if(u)continue;const row={customer_id:type==='customer'?id:null,listing_id:type==='listing'?id:null,document_type:$('#docType').value,file_name:f.name,storage_path:path,uploaded_by:state.profile.id};const {error:d}=await state.client.from('contract_documents').insert(row);if(d){await state.client.storage.from('contract-documents').remove([path]);continue}ok++}toast(`${ok}개 서류를 업로드했습니다.`);loadContractDocuments()}
async function loadContractDocuments(){const type=$('#docTargetType').value,id=$('#docTarget').value;if(!id)return;const col=type==='customer'?'customer_id':'listing_id';const {data,error}=await state.client.from('contract_documents').select('*').eq(col,id).order('created_at',{ascending:false});if(error)return toast(error.message);$('#documentList').innerHTML=(data||[]).length?`<div class="document-grid">${data.map(x=>`<div class="document-item"><div><strong>${escapeHtml(x.file_name)}</strong><div class="muted">${escapeHtml(x.document_type)} · ${fmtDate(x.created_at)}</div></div><div><button onclick="downloadContractDocument('${x.storage_path}','${escapeHtml(x.file_name)}')">다운로드</button><button class="danger" onclick="deleteContractDocument('${x.id}','${x.storage_path}')">삭제</button></div></div>`).join('')}</div>`:'<div class="empty">등록된 서류가 없습니다.</div>'}
async function downloadContractDocument(path,name){const {data,error}=await state.client.storage.from('contract-documents').download(path);if(error)return toast(error.message);downloadBlob(data,name)}
async function deleteContractDocument(id,path){if(!confirm('서류를 삭제할까요?'))return;await state.client.from('contract_documents').delete().eq('id',id);await state.client.storage.from('contract-documents').remove([path]);loadContractDocuments()}

function exportRowsExcel(rows,fileName){if(!window.XLSX)return toast('엑셀 라이브러리를 불러오지 못했습니다.');const ws=XLSX.utils.json_to_sheet(rows),wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'목록');XLSX.writeFile(wb,fileName)}
function exportCustomersExcel(){if(state.profile.role!=='admin')return toast('관리자만 엑셀 내보내기를 사용할 수 있습니다.');exportRowsExcel(state.customers.map(x=>({고객명:x.name,연락처:x.phone,구분:x.customer_type,거래유형:x.deal_type,등급:x.customer_grade,희망지역:x.preferred_area,희망금액만원:x.budget_max,희망월세만원:x.desired_monthly_rent,희망방개수:x.desired_rooms,상태:x.status,메모:x.notes})),'고객목록.xlsx')}
function exportListingsExcel(){if(state.profile.role!=='admin')return toast('관리자만 엑셀 내보내기를 사용할 수 있습니다.');exportRowsExcel(state.listings.map(x=>({담당중개사:x.owner?.full_name||'',매물명:x.title,거래유형:x.transaction_type,부동산유형:x.property_type,주소:x.address,가격만원:x.price,월세만원:x.monthly_rent,'면적㎡':x.area_m2,방:x.room_count,화장실:x.bathroom_count,연락처:x.contact_phone,공개:x.is_public?'공개':'비공개',상태:x.status,설명:x.description})),'전체매물목록.xlsx')}
function openExcelImport(kind){const input=document.createElement('input');input.type='file';input.accept='.xlsx,.xls,.csv';input.onchange=()=>importExcelFile(kind,input.files[0]);input.click()}
async function importExcelFile(kind,file){if(state.profile.role!=='admin')return toast('관리자만 엑셀 가져오기를 사용할 수 있습니다.');if(!file)return;const importOwner=$('#excelImportOwner')?.value||state.profile.id;const buf=await file.arrayBuffer(),wb=XLSX.read(buf),rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);if(!rows.length)return toast('가져올 데이터가 없습니다.');let payload;if(kind==='customer')payload=rows.map(r=>({owner_id:importOwner,original_owner_id:importOwner,name:r.고객명||r.name,phone:r.연락처||r.phone,customer_type:r.구분||r.customer_type||'매수',deal_type:r.거래유형||r.deal_type||'매매',customer_grade:r.등급||r.customer_grade||'C',preferred_area:r.희망지역||r.preferred_area,budget_max:r.희망금액만원||r.budget_max||null,desired_monthly_rent:r.희망월세만원||null,desired_rooms:r.희망방개수||null,status:r.상태||'신규',notes:r.메모||''})).filter(x=>x.name);else payload=rows.map(r=>({owner_id:importOwner,original_owner_id:importOwner,title:r.매물명||r.title,transaction_type:r.거래유형||'매매',property_type:r.부동산유형||'아파트',address:r.주소||'',price:r.가격만원||null,monthly_rent:r.월세만원||null,area_m2:r['면적㎡']||null,room_count:r.방||null,bathroom_count:r.화장실||null,contact_phone:r.연락처||'',is_public:String(r.공개||'공개')!=='비공개',status:r.상태||'available',description:r.설명||''})).filter(x=>x.title);const {error}=await state.client.from(kind==='customer'?'customers':'listings').insert(payload);if(error)return toast(error.message);toast(`${payload.length}건을 가져왔습니다.`);kind==='customer'?renderCustomers():renderMyListings()}

const v300OriginalMyListings=renderMyListings;
renderMyListings=async function(){await v300OriginalMyListings();const stale=state.myListings.filter(x=>(x.next_confirm_at||x.last_confirmed_at)&&daysFromToday(x.next_confirm_at||x.last_confirmed_at)<=0&&x.status!=='complete');if(stale.length){const n=document.createElement('div');n.className='notice warning-notice';n.innerHTML=`확인 필요 매물 <strong>${stale.length}개</strong> · 매물 수정에서 다음 확인일을 변경하세요.`;$('#content').prepend(n)}}

async function renderAdminData(){
  if(state.profile.role!=='admin')return toast('관리자만 이용할 수 있습니다.');
  await Promise.all([loadMembers(),loadCustomers(),loadListings()]);
  const approved=state.members.filter(x=>x.status==='approved');
  $('#content').innerHTML=`<div class="split"><section class="panel"><div class="panel-head"><h3>엑셀 내보내기</h3></div><p class="muted">관리자가 열람 가능한 전체 고객과 전체 매물을 내려받습니다.</p><div class="stack"><button class="primary" onclick="exportCustomersExcel()">전체 고객 엑셀 내보내기</button><button class="primary" onclick="exportListingsExcel()">전체 매물 엑셀 내보내기</button></div></section><section class="panel"><div class="panel-head"><h3>엑셀 가져오기</h3></div><p class="muted">가져온 자료의 담당 중개사를 먼저 지정하세요.</p><label>등록 담당 중개사<select id="excelImportOwner">${approved.map(x=>`<option value="${x.id}" ${x.id===state.profile.id?'selected':''}>${escapeHtml(x.full_name)} · ${escapeHtml(x.office_name||'')}</option>`).join('')}</select></label><div class="stack" style="margin-top:16px"><button class="ghost" onclick="openExcelImport('customer')">고객 엑셀 가져오기</button><button class="ghost" onclick="openExcelImport('listing')">매물 엑셀 가져오기</button></div><div class="notice" style="margin-top:16px">가져오기는 기존 데이터와 자동 병합되지 않습니다. 전화번호·주소 중복 여부를 확인한 뒤 진행하세요.</div></section></div>`;
}

const v300OriginalOpenCustomerModal=openCustomerModal;
openCustomerModal=function(id){v300OriginalOpenCustomerModal(id);setTimeout(()=>{const phone=$('#modalBody [name=phone]');if(phone)phone.addEventListener('blur',async()=>{if(!phone.value)return;let q=state.client.from('customers').select('id,name,phone').eq('phone',phone.value);if(id)q=q.neq('id',id);const {data}=await q.limit(3);if(data?.length)toast(`중복 가능성: 같은 전화번호 고객 ${data.map(x=>x.name).join(', ')}`)})},50)}
const v300OriginalOpenListingModal=openListingModal;
openListingModal=function(id){v300OriginalOpenListingModal(id);setTimeout(()=>{const address=$('#modalBody [name=address]');if(address)address.addEventListener('blur',async()=>{if(!address.value)return;let q=state.client.from('listings').select('id,title,address').eq('address',address.value);if(id)q=q.neq('id',id);const {data}=await q.limit(5);if(data?.length)toast(`중복 가능성: 같은 주소 매물 ${data.map(x=>x.title).join(', ')}`)});const formGrid=$('#modalBody .form-grid');if(formGrid&&!$('#modalBody [name=next_confirm_at]'))formGrid.insertAdjacentHTML('beforeend',`<label>다음 매물 확인일<input name="next_confirm_at" type="date" value="${dateInDays(14)}"></label>`)},50)}

const v300OriginalExecuteTransfer=executeTransfer;
executeTransfer=async function(){if(!confirm('고객·매물·진행 중 계약·예정 FU를 새 담당자에게 이관하고 계정 상태를 변경할까요?'))return;const payload={p_from:$('#fromMember').value,p_to:$('#toMember').value,p_reason:$('#transferReason').value,p_after_status:$('#afterStatus').value};const {data,error}=await state.client.rpc('transfer_agent_assets_v3',payload);if(error)return v300OriginalExecuteTransfer();toast(`통합 이관 완료: 고객 ${data.customers}명, 매물 ${data.listings}개`);renderTransfer()}

const v300OriginalPhotoGallery=renderListingPhotoGallery;
renderListingPhotoGallery=async function(listing){
  const {data,error}=await state.client.from('listing_photos').select('*').eq('listing_id',listing.id).order('sort_order').order('created_at');if(error)return toast(error.message);const photos=data||[];const cards=[];for(const p of photos){const url=await signedPhotoUrl(p.storage_path);cards.push(`<div class="photo-card ${listing.cover_photo_id===p.id?'cover':''}">${url?`<img src="${url}" onclick="window.open('${url}','_blank')">`:''}<div class="photo-meta"><input value="${escapeHtml(p.caption||'')}" placeholder="사진 설명" onchange="updatePhotoMeta('${p.id}','caption',this.value)"><select onchange="updatePhotoMeta('${p.id}','photo_category',this.value)">${['거실','주방','방','화장실','외관','뷰','기타'].map(c=>`<option ${p.photo_category===c?'selected':''}>${c}</option>`).join('')}</select><label><input type="checkbox" ${p.is_customer_visible?'checked':''} onchange="updatePhotoMeta('${p.id}','is_customer_visible',this.checked)"> 고객용 공개</label><input type="number" value="${p.sort_order||0}" onchange="updatePhotoMeta('${p.id}','sort_order',Number(this.value))" title="순서"><button onclick="setCoverPhoto('${listing.id}','${p.id}')">대표사진</button>${canManageListing(listing)?`<button class="danger" onclick="deleteListingPhoto('${listing.id}','${p.id}','${p.storage_path}')">삭제</button>`:''}</div></div>`)}$('#modalBody').innerHTML=`<div class="photo-toolbar"><div><strong>${photos.length}장</strong><div class="muted">대표사진·분류·설명·고객 공개 여부·순서를 관리합니다.</div></div><div><button class="ghost" onclick="downloadAllListingPhotos('${listing.id}')">전체 ZIP 다운로드</button>${canManageListing(listing)?`<button class="primary" onclick="addListingPhotos('${listing.id}')">사진 추가</button>`:''}</div></div><div class="photo-grid">${cards.join('')||'<div class="empty">등록된 사진이 없습니다.</div>'}</div>`;
}
async function updatePhotoMeta(id,key,value){const {error}=await state.client.from('listing_photos').update({[key]:value}).eq('id',id);if(error)return toast(error.message);toast('사진 정보를 저장했습니다.')}
async function setCoverPhoto(listingId,photoId){const {error}=await state.client.from('listings').update({cover_photo_id:photoId}).eq('id',listingId);if(error)return toast(error.message);toast('대표사진을 지정했습니다.');await loadListings();const l=state.listings.find(x=>x.id===listingId);renderListingPhotoGallery(l)}

console.info('CRM v3.1 관리자 데이터관리·정밀 자동매칭 로드 완료');

/* ================= CRM v3.2 중개사별 엑셀 선택 관리 ================= */
state.adminExcel = {
  ownerId:'',
  type:'customer',
  customerSelection:new Set(),
  listingSelection:new Set(),
  importKind:null,
  importRows:[],
  importSelection:new Set(),
  importFileName:''
};

function excelOwnerName(ownerId){
  const m=state.members.find(x=>x.id===ownerId);
  return m?.full_name||'담당자 미지정';
}
function customerExcelRow(x){
  return {
    담당중개사:excelOwnerName(x.owner_id),
    고객명:x.name,연락처:x.phone,구분:x.customer_type,거래유형:x.deal_type,등급:x.customer_grade,
    희망지역:x.preferred_area,희망금액만원:x.budget_max,희망월세만원:x.desired_monthly_rent,
    희망방개수:x.desired_rooms,대출여부:x.loan_status,자기자본금만원:x.equity_amount,
    자기자본금모름:x.equity_unknown?'모름':'',상태:x.status,메모:x.notes
  };
}
function listingExcelRow(x){
  return {
    담당중개사:excelOwnerName(x.owner_id),매물명:x.title,거래유형:x.transaction_type,
    부동산유형:x.property_type,주소:x.address,가격만원:x.price,월세만원:x.monthly_rent,
    '면적㎡':x.area_m2,방:x.room_count,화장실:x.bathroom_count,연락처:x.contact_phone,
    공개:x.is_public?'공개':'비공개',상태:x.status,설명:x.description
  };
}
function safeAgentFileName(name='중개사'){return String(name).replace(/[\\/:*?"<>|]/g,'_').trim()||'중개사'}
function adminExcelRows(type){
  const owner=state.adminExcel.ownerId;
  return (type==='customer'?state.customers:state.listings).filter(x=>!owner||x.owner_id===owner);
}
function setAdminExcelOwner(value){
  state.adminExcel.ownerId=value;
  state.adminExcel.customerSelection.clear();state.adminExcel.listingSelection.clear();
  renderAdminExcelList();
}
function setAdminExcelType(type){
  state.adminExcel.type=type;renderAdminExcelList();
}
function toggleAdminExcelRow(type,id,checked){
  const set=type==='customer'?state.adminExcel.customerSelection:state.adminExcel.listingSelection;
  checked?set.add(id):set.delete(id);updateAdminExcelSelectionUi();
}
function toggleAdminExcelAll(type,checked){
  const rows=adminExcelRows(type),set=type==='customer'?state.adminExcel.customerSelection:state.adminExcel.listingSelection;
  rows.forEach(x=>checked?set.add(x.id):set.delete(x.id));renderAdminExcelList();
}
function updateAdminExcelSelectionUi(){
  const type=state.adminExcel.type,set=type==='customer'?state.adminExcel.customerSelection:state.adminExcel.listingSelection;
  const count=$('#adminExcelSelectedCount');if(count)count.textContent=`${set.size}개 선택`;
  const btn=$('#adminExcelSelectedDownload');if(btn)btn.disabled=!set.size;
}
function renderAdminExcelList(){
  const box=$('#adminExcelList');if(!box)return;
  const type=state.adminExcel.type,rows=adminExcelRows(type),set=type==='customer'?state.adminExcel.customerSelection:state.adminExcel.listingSelection;
  box.innerHTML=`
    <div class="excel-list-toolbar">
      <div class="segmented"><button class="${type==='customer'?'active':''}" onclick="setAdminExcelType('customer')">고객 목록</button><button class="${type==='listing'?'active':''}" onclick="setAdminExcelType('listing')">매물 목록</button></div>
      <div class="row-actions"><span id="adminExcelSelectedCount" class="muted">${set.size}개 선택</span><button id="adminExcelSelectedDownload" class="primary" ${set.size?'':'disabled'} onclick="downloadAdminExcelSelected()">선택 항목 다운로드</button><button class="ghost" onclick="downloadAdminExcelAllForOwner()">현재 중개사 전체 다운로드</button></div>
    </div>
    <div class="table-wrap excel-select-table"><table><thead><tr><th><input type="checkbox" ${rows.length&&rows.every(x=>set.has(x.id))?'checked':''} onchange="toggleAdminExcelAll('${type}',this.checked)"></th>${type==='customer'?'<th>고객명</th><th>연락처</th><th>구분</th><th>거래유형</th><th>희망지역</th><th>금액</th><th>상태</th>':'<th>매물명</th><th>거래유형</th><th>주소</th><th>가격</th><th>방/욕실</th><th>공개</th><th>상태</th>'}</tr></thead><tbody>
    ${rows.map(x=>type==='customer'?`<tr><td><input type="checkbox" ${set.has(x.id)?'checked':''} onchange="toggleAdminExcelRow('customer','${x.id}',this.checked)"></td><td><strong>${escapeHtml(x.name)}</strong></td><td>${escapeHtml(x.phone||'-')}</td><td>${escapeHtml(x.customer_type||'-')}</td><td>${escapeHtml(x.deal_type||'-')}</td><td>${escapeHtml(x.preferred_area||'-')}</td><td>${customerBudgetText(x)}</td><td>${escapeHtml(x.status||'-')}</td></tr>`:`<tr><td><input type="checkbox" ${set.has(x.id)?'checked':''} onchange="toggleAdminExcelRow('listing','${x.id}',this.checked)"></td><td><strong>${escapeHtml(x.title)}</strong></td><td>${escapeHtml(x.transaction_type||'-')}</td><td>${escapeHtml(x.address||'-')}</td><td>${listingPriceText(x)}</td><td>${x.room_count??'-'} / ${x.bathroom_count??'-'}</td><td>${x.is_public?'공개':'비공개'}</td><td>${escapeHtml(x.status||'-')}</td></tr>`).join('')||`<tr><td colspan="8"><div class="empty">해당 중개사의 ${type==='customer'?'고객':'매물'}이 없습니다.</div></td></tr>`}
    </tbody></table></div>`;
}
function downloadAdminExcelSelected(){
  if(state.profile.role!=='admin')return toast('관리자만 사용할 수 있습니다.');
  const type=state.adminExcel.type,set=type==='customer'?state.adminExcel.customerSelection:state.adminExcel.listingSelection;
  const rows=adminExcelRows(type).filter(x=>set.has(x.id));if(!rows.length)return toast('다운로드할 항목을 선택하세요.');
  const agent=safeAgentFileName(state.adminExcel.ownerId?excelOwnerName(state.adminExcel.ownerId):'전체중개사');
  exportRowsExcel(rows.map(type==='customer'?customerExcelRow:listingExcelRow),`${agent}_${type==='customer'?'고객':'매물'}_선택_${rows.length}건.xlsx`);
}
function downloadAdminExcelAllForOwner(){
  if(state.profile.role!=='admin')return toast('관리자만 사용할 수 있습니다.');
  const type=state.adminExcel.type,rows=adminExcelRows(type);if(!rows.length)return toast('다운로드할 데이터가 없습니다.');
  const agent=safeAgentFileName(state.adminExcel.ownerId?excelOwnerName(state.adminExcel.ownerId):'전체중개사');
  exportRowsExcel(rows.map(type==='customer'?customerExcelRow:listingExcelRow),`${agent}_${type==='customer'?'고객':'매물'}_전체_${rows.length}건.xlsx`);
}
function downloadAgentBundle(ownerId){
  if(state.profile.role!=='admin')return toast('관리자만 사용할 수 있습니다.');
  const member=state.members.find(x=>x.id===ownerId),name=safeAgentFileName(member?.full_name||'중개사');
  const customers=state.customers.filter(x=>x.owner_id===ownerId),listings=state.listings.filter(x=>x.owner_id===ownerId);
  if(!customers.length&&!listings.length)return toast('다운로드할 데이터가 없습니다.');
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(customers.map(customerExcelRow)),'고객');
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(listings.map(listingExcelRow)),'매물');
  XLSX.writeFile(wb,`${name}_고객매물_전체.xlsx`);
}

function openExcelImport(kind){
  if(state.profile.role!=='admin')return toast('관리자만 엑셀 가져오기를 사용할 수 있습니다.');
  const input=document.createElement('input');input.type='file';input.accept='.xlsx,.xls,.csv';
  input.onchange=()=>previewExcelImport(kind,input.files[0]);input.click();
}
async function previewExcelImport(kind,file){
  if(!file)return;
  try{
    const buf=await file.arrayBuffer(),wb=XLSX.read(buf),raw=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:''});
    if(!raw.length)return toast('가져올 데이터가 없습니다.');
    const parsed=kind==='customer'?raw.map((r,i)=>({rowNo:i+2,data:{name:r.고객명||r.name,phone:r.연락처||r.phone,customer_type:r.구분||r.customer_type||'매수',deal_type:r.거래유형||r.deal_type||'매매',customer_grade:r.등급||r.customer_grade||'C',preferred_area:r.희망지역||r.preferred_area,budget_max:r.희망금액만원||r.budget_max||null,desired_monthly_rent:r.희망월세만원||r.desired_monthly_rent||null,desired_rooms:r.희망방개수||r.desired_rooms||null,status:r.상태||'신규',notes:r.메모||''},valid:!!(r.고객명||r.name),label:r.고객명||r.name||'(고객명 없음)' }))
      :raw.map((r,i)=>({rowNo:i+2,data:{title:r.매물명||r.title,transaction_type:r.거래유형||r.transaction_type||'매매',property_type:r.부동산유형||r.property_type||'아파트',address:r.주소||r.address||'',price:r.가격만원||r.price||null,monthly_rent:r.월세만원||r.monthly_rent||null,area_m2:r['면적㎡']||r.area_m2||null,room_count:r.방||r.room_count||null,bathroom_count:r.화장실||r.bathroom_count||null,contact_phone:r.연락처||r.contact_phone||'',is_public:String(r.공개||'공개')!=='비공개',status:r.상태||'available',description:r.설명||''},valid:!!(r.매물명||r.title),label:r.매물명||r.title||'(매물명 없음)'}));
    state.adminExcel.importKind=kind;state.adminExcel.importRows=parsed;state.adminExcel.importSelection=new Set(parsed.map((x,i)=>x.valid?i:null).filter(x=>x!==null));state.adminExcel.importFileName=file.name;
    renderExcelImportPreview();
  }catch(e){toast('엑셀 파일을 읽지 못했습니다: '+e.message)}
}
function toggleExcelImportRow(index,checked){checked?state.adminExcel.importSelection.add(index):state.adminExcel.importSelection.delete(index);updateExcelImportCount()}
function toggleExcelImportAll(checked){state.adminExcel.importRows.forEach((x,i)=>{if(x.valid)(checked?state.adminExcel.importSelection.add(i):state.adminExcel.importSelection.delete(i))});renderExcelImportPreview()}
function updateExcelImportCount(){const el=$('#excelImportSelectedCount');if(el)el.textContent=`${state.adminExcel.importSelection.size}건 선택`;const b=$('#excelImportExecute');if(b)b.disabled=!state.adminExcel.importSelection.size}
function renderExcelImportPreview(){
  const box=$('#excelImportPreview');if(!box)return;
  const kind=state.adminExcel.importKind,rows=state.adminExcel.importRows,set=state.adminExcel.importSelection;
  box.innerHTML=`<div class="panel import-preview-panel"><div class="panel-head"><div><h3>${kind==='customer'?'고객':'매물'} 가져오기 미리보기</h3><div class="muted">${escapeHtml(state.adminExcel.importFileName)} · 필요한 행만 체크한 뒤 가져오세요.</div></div><button class="icon-btn" onclick="clearExcelImportPreview()">×</button></div><div class="excel-list-toolbar"><label><input type="checkbox" ${rows.filter(x=>x.valid).length&&rows.filter(x=>x.valid).every((x,i)=>set.has(rows.indexOf(x)))?'checked':''} onchange="toggleExcelImportAll(this.checked)"> 유효 행 전체 선택</label><div class="row-actions"><span id="excelImportSelectedCount" class="muted">${set.size}건 선택</span><button id="excelImportExecute" class="primary" ${set.size?'':'disabled'} onclick="executeSelectedExcelImport()">선택 행 가져오기</button></div></div><div class="table-wrap excel-select-table"><table><thead><tr><th>선택</th><th>행</th><th>${kind==='customer'?'고객명':'매물명'}</th><th>${kind==='customer'?'연락처':'주소'}</th><th>구분</th><th>상태</th></tr></thead><tbody>${rows.map((x,i)=>`<tr class="${x.valid?'':'invalid-row'}"><td><input type="checkbox" ${set.has(i)?'checked':''} ${x.valid?'':'disabled'} onchange="toggleExcelImportRow(${i},this.checked)"></td><td>${x.rowNo}</td><td><strong>${escapeHtml(x.label)}</strong>${x.valid?'':' '+badge('필수값 없음','red')}</td><td>${escapeHtml(kind==='customer'?(x.data.phone||'-'):(x.data.address||'-'))}</td><td>${escapeHtml(kind==='customer'?(x.data.customer_type||'-'):(x.data.transaction_type||'-'))}</td><td>${escapeHtml(x.data.status||'-')}</td></tr>`).join('')}</tbody></table></div></div>`;
}
function clearExcelImportPreview(){state.adminExcel.importRows=[];state.adminExcel.importSelection.clear();const box=$('#excelImportPreview');if(box)box.innerHTML=''}
async function executeSelectedExcelImport(){
  if(state.profile.role!=='admin')return toast('관리자만 사용할 수 있습니다.');
  const owner=$('#excelImportOwner')?.value;if(!owner)return toast('등록 담당 중개사를 선택하세요.');
  const kind=state.adminExcel.importKind,selected=[...state.adminExcel.importSelection].sort((a,b)=>a-b).map(i=>state.adminExcel.importRows[i]).filter(x=>x?.valid);
  if(!selected.length)return toast('가져올 행을 선택하세요.');
  if(!confirm(`${selected.length}건을 ${excelOwnerName(owner)} 담당으로 가져올까요?`))return;
  const payload=selected.map(x=>({...x.data,owner_id:owner,original_owner_id:owner}));
  const {error}=await state.client.from(kind==='customer'?'customers':'listings').insert(payload);
  if(error)return toast(error.message);
  toast(`${payload.length}건을 가져왔습니다.`);clearExcelImportPreview();await Promise.all([loadCustomers(),loadListings()]);renderAdminExcelList();
}

renderAdminData=async function(){
  if(state.profile.role!=='admin')return toast('관리자만 이용할 수 있습니다.');
  await Promise.all([loadMembers(),loadCustomers(),loadListings()]);
  const approved=state.members.filter(x=>x.status==='approved');
  if(!state.adminExcel.ownerId)state.adminExcel.ownerId=state.profile.id;
  $('#content').innerHTML=`
    <section class="panel"><div class="panel-head"><div><h3>중개사별 엑셀 내보내기</h3><p class="muted">중개사를 선택해 목록을 확인하고 일부 항목만 체크하거나, 해당 중개사의 고객·매물을 한 파일로 일괄 다운로드할 수 있습니다.</p></div></div>
      <div class="excel-agent-bar"><label>중개사 선택<select id="adminExcelOwner" onchange="setAdminExcelOwner(this.value)"><option value="">전체 중개사</option>${approved.map(x=>`<option value="${x.id}" ${x.id===state.adminExcel.ownerId?'selected':''}>${escapeHtml(x.full_name)} · ${escapeHtml(x.office_name||'')}</option>`).join('')}</select></label><button class="primary" onclick="downloadAgentBundle($('#adminExcelOwner').value)" ${state.adminExcel.ownerId?'':'disabled'}>선택 중개사 고객·매물 전체 다운로드</button></div>
      <div id="adminExcelList" style="margin-top:18px"></div>
    </section>
    <section class="panel" style="margin-top:18px"><div class="panel-head"><div><h3>엑셀 선택 가져오기</h3><p class="muted">파일을 먼저 읽어 목록을 확인한 뒤 필요한 행만 체크해서 가져옵니다.</p></div></div>
      <div class="excel-import-controls"><label>등록 담당 중개사<select id="excelImportOwner">${approved.map(x=>`<option value="${x.id}" ${x.id===state.profile.id?'selected':''}>${escapeHtml(x.full_name)} · ${escapeHtml(x.office_name||'')}</option>`).join('')}</select></label><div class="row-actions"><button class="ghost" onclick="openExcelImport('customer')">고객 엑셀 선택</button><button class="ghost" onclick="openExcelImport('listing')">매물 엑셀 선택</button></div></div>
      <div class="notice" style="margin-top:14px">가져오기 전 미리보기에서 행별 선택이 가능합니다. 기존 데이터와 자동 병합되지는 않으므로 전화번호와 주소 중복을 확인하세요.</div><div id="excelImportPreview" style="margin-top:18px"></div>
    </section>`;
  renderAdminExcelList();
};

console.info('CRM v3.2 중개사별 엑셀 선택관리 로드 완료');
