const state = { client:null, session:null, profile:null, view:'dashboard', customers:[], listings:[], members:[], adminSelectedListings:new Set() };
const $ = (s)=>document.querySelector(s);
const $$ = (s)=>[...document.querySelectorAll(s)];
const SUPA_URL_KEY='crm_supabase_url', SUPA_ANON_KEY='crm_supabase_anon';
const DEFAULT_SUPABASE_URL='https://zcxxxqyntzlvyaakbnlq.supabase.co';
const DEFAULT_SUPABASE_PUBLISHABLE_KEY='sb_publishable_k1lbkjVDKgYgxq_kp9lzsw_iNGSVbnJ';

function toast(msg){
  let text=String(msg||'');
  if(text.includes('duplicate_listing_same_trade')){
    text='동일한 주소·동·호수에 같은 거래유형 매물이 이미 등록되어 있습니다. 기존 매물의 담당 중개사와 거래유형을 확인해 주세요.';
  }else if(text.includes('duplicate_listing_address')){
    text='동일한 주소·동·호수의 매물이 이미 등록되어 있어 저장할 수 없습니다.';
  }
  const el=$('#toast');el.textContent=text;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),4200)
}
function showOnly(id){['setupScreen','authScreen','pendingScreen','appScreen'].forEach(x=>$('#'+x).classList.toggle('hidden',x!==id))}
function fmtMoney(v){if(v===null||v===undefined||v==='')return '-';return Number(v).toLocaleString('ko-KR')+'만원'}
function fmtDate(v){return v?new Date(v).toLocaleDateString('ko-KR'):'-'}
function today(){return new Date().toISOString().slice(0,10)}
function dueBadge(v){if(!v)return '-';const d=new Date(v+'T00:00:00'),now=new Date(today()+'T00:00:00');const diff=Math.round((d-now)/86400000);return diff<0?badge(fmtDate(v)+' 지남','red'):diff===0?badge('오늘','yellow'):badge(fmtDate(v),'blue')}
function moveInText(x){if(x.move_in_immediate)return '즉시입주 가능';if(x.move_in_date&&x.move_in_negotiable)return `${fmtDate(x.move_in_date)}<br><span class="muted">협의 가능</span>`;if(x.move_in_date)return fmtDate(x.move_in_date);if(x.move_in_negotiable)return '협의 가능';return '-'}
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
  const url=DEFAULT_SUPABASE_URL;
  const key=DEFAULT_SUPABASE_PUBLISHABLE_KEY;
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
function customerRoomText(x){
  if(x?.desired_one_point_five_room)return '1.5룸';
  return x?.desired_rooms!==null&&x?.desired_rooms!==undefined&&x?.desired_rooms!==''?`${escapeHtml(String(x.desired_rooms))}개`:'-';
}
function listingRoomText(x){
  if(x?.is_one_point_five_room)return '1.5룸';
  return x?.room_count!==null&&x?.room_count!==undefined?escapeHtml(String(x.room_count)):'-';
}
function customerRoomValue(x){return x?.desired_one_point_five_room?1.5:moneyNumber(x?.desired_rooms)}
function listingRoomValue(x){return x?.is_one_point_five_room?1.5:moneyNumber(x?.room_count)}
function filterCustomers(){
  const q=($('#customerSearch')?.value||'').toLowerCase(), t=$('#customerType')?.value||'', s=$('#customerStatus')?.value||'', d=$('#customerDealType')?.value||'', g=$('#customerGrade')?.value||'';
  const rows=state.customers.filter(x=>(!q||`${x.name} ${x.phone}`.toLowerCase().includes(q))&&(!t||x.customer_type===t)&&(!s||x.status===s)&&(!d||x.deal_type===d)&&(!g||x.customer_grade===g));
  $('#customerTable').innerHTML=rows.length?`<div class="table-wrap"><table class="customer-table"><thead><tr><th>고객명</th><th>연락처</th><th>구분</th><th>상태</th><th>거래유형</th><th>등급</th><th>희망지역</th><th>방개수</th><th>희망금액/월세</th><th>계약단계</th><th>최종 FU</th><th>예정 FU</th><th>관리</th></tr></thead><tbody>${rows.map(x=>`<tr><td><strong>${escapeHtml(x.name)}</strong></td><td>${escapeHtml(x.phone||'-')}</td><td>${escapeHtml(x.customer_type)}</td><td>${badge(x.status||'신규','blue')}</td><td>${escapeHtml(x.deal_type||'-')}</td><td>${gradeBadge(x.customer_grade)}</td><td>${escapeHtml(x.preferred_area||'-')}</td><td>${customerRoomText(x)}</td><td>${customerBudgetText(x)}</td><td>${contractStage(x)}</td><td>${fmtDate(x.last_follow_up_at)}</td><td>${dueBadge(x.next_follow_up_at)}</td><td><div class="row-actions"><button class="success" onclick="openFollowUpModal('customer','${x.id}')">FU</button><button class="ghost" onclick="openHistoryModal('customer','${x.id}')">히스토리</button><button class="ghost" onclick="openContractModal('customer','${x.id}')">진행상황</button><button class="ghost" onclick="openCustomerModal('${x.id}')">수정</button><button class="danger" onclick="deleteCustomer('${x.id}')">삭제</button></div></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">조건에 맞는 고객이 없습니다.</div>';
}
function openCustomerModal(id){
  const x=state.customers.find(v=>v.id===id)||{};$('#modalTitle').textContent=id?'고객 수정':'고객 등록';
  $('#modalBody').innerHTML=`<div class="form-grid"><label>고객명<input name="name" value="${escapeHtml(x.name||'')}" required></label><label>연락처<input name="phone" value="${escapeHtml(x.phone||'')}" placeholder="010-0000-0000" required></label><label>고객 구분<select id="customerKind" name="customer_type"><option>매수</option><option>매도</option><option>임차</option><option>임대</option></select></label><label>상태<select name="status"><option>신규</option><option>상담중</option><option>매물제안</option><option>방문예정</option><option>계약협의</option><option>계약완료</option><option>보류</option></select></label><label id="customerDealTypeWrap">거래유형<select name="deal_type"><option value="">선택</option><option>매매</option><option>전세</option><option>월세</option><option>매매+전세</option><option>매매+월세</option><option>전세+월세</option></select></label><label>고객등급<select name="customer_grade"><option>A</option><option>B</option><option>C</option><option>D</option></select></label><label>희망 지역<input name="preferred_area" value="${escapeHtml(x.preferred_area||'')}"></label><label id="customerRoomsWrap">희망 방개수<div class="inline-field"><input id="desiredRoomsInput" name="desired_rooms" type="number" min="0" step="1" value="${x.desired_rooms??''}" placeholder="예: 3"><label class="inline-check"><input id="desiredOnePointFiveCheck" name="desired_one_point_five_room" type="checkbox" ${x.desired_one_point_five_room?'checked':''}> 1.5룸</label></div></label><label>희망 보증금/최대금액(만원)<input name="budget_max" type="number" value="${x.budget_max||''}"></label><label id="customerMonthlyRentWrap">희망 월세(만원)<input name="desired_monthly_rent" type="number" min="0" value="${x.desired_monthly_rent??''}" placeholder="예: 100"></label><label id="customerLoanWrap">대출 여부<select name="loan_available"><option value="true">O</option><option value="false">X</option></select></label><label id="customerEquityWrap">자기자본금(만원)<div class="inline-field"><input id="equityCapitalInput" name="equity_capital" type="number" min="0" value="${x.equity_capital??''}" placeholder="예: 20000"><label class="inline-check"><input id="equityUnknownCheck" name="equity_unknown" type="checkbox" ${x.equity_unknown?'checked':''}> 모름</label></div></label><label>예정 FU<input name="next_follow_up_at" type="date" value="${x.next_follow_up_at?x.next_follow_up_at.slice(0,10):''}"></label><label class="span-2">상담 메모<textarea name="notes" rows="5">${escapeHtml(x.notes||'')}</textarea></label></div>`;
  const kind=$('#customerKind');kind.value=x.customer_type||'매수';
  const dealWrap=$('#customerDealTypeWrap'),roomsWrap=$('#customerRoomsWrap'),monthlyWrap=$('#customerMonthlyRentWrap'),loanWrap=$('#customerLoanWrap'),equityWrap=$('#customerEquityWrap'),equityInput=$('#equityCapitalInput'),equityUnknown=$('#equityUnknownCheck'),desiredRoomsInput=$('#desiredRoomsInput'),desiredOnePointFive=$('#desiredOnePointFiveCheck');
  const syncDesiredOnePointFive=()=>{if(desiredOnePointFive.checked){desiredRoomsInput.value='1';desiredRoomsInput.disabled=true}else desiredRoomsInput.disabled=false};desiredOnePointFive.onchange=syncDesiredOnePointFive;syncDesiredOnePointFive();const syncEquityUnknown=()=>{equityInput.disabled=equityUnknown.checked;if(equityUnknown.checked)equityInput.value='';};equityUnknown.onchange=syncEquityUnknown;syncEquityUnknown();const syncMonthlyField=()=>{const show=['매수','임차'].includes(kind.value)&&($('#modalBody [name=deal_type]').value||'').includes('월세');monthlyWrap.style.display=show?'':'none';if(!show)monthlyWrap.querySelector('input').value=''};const toggleBuyerFields=()=>{const show=['매수','임차'].includes(kind.value);[dealWrap,roomsWrap,loanWrap,equityWrap].forEach(el=>el.style.display=show?'':'none');if(!show){dealWrap.querySelector('select').value='';roomsWrap.querySelector('input').value='';desiredOnePointFive.checked=false;syncDesiredOnePointFive();loanWrap.querySelector('select').value='false';equityInput.value='';equityUnknown.checked=false;syncEquityUnknown()}syncMonthlyField()};$('#modalBody [name=deal_type]').onchange=syncMonthlyField;
  kind.onchange=toggleBuyerFields;toggleBuyerFields();
  $('#modalBody').querySelector('[name=status]').value=x.status||'신규';$('#modalBody').querySelector('[name=deal_type]').value=x.deal_type||'';$('#modalBody').querySelector('[name=customer_grade]').value=x.customer_grade||'C';$('#modalBody').querySelector('[name=loan_available]').value=x.loan_available===true?'true':'false';
  $('#modalSubmit').onclick=async(e)=>{e.preventDefault();const fd=new FormData($('#modalForm'));const payload=Object.fromEntries(fd.entries());payload.owner_id=state.profile.id;const buyerSide=['매수','임차'].includes(payload.customer_type);payload.deal_type=buyerSide?(payload.deal_type||null):null;payload.customer_grade=payload.customer_grade||'C';payload.budget_max=payload.budget_max?Number(payload.budget_max):null;payload.desired_monthly_rent=buyerSide&&(payload.deal_type||'').includes('월세')&&payload.desired_monthly_rent?Number(payload.desired_monthly_rent):null;payload.desired_one_point_five_room=buyerSide&&payload.desired_one_point_five_room==='on';payload.desired_rooms=buyerSide?(payload.desired_one_point_five_room?1:(payload.desired_rooms!==''?Number(payload.desired_rooms):null)):null;payload.loan_available=buyerSide?payload.loan_available==='true':null;payload.equity_unknown=buyerSide&&payload.equity_unknown==='on';payload.equity_capital=buyerSide&&!payload.equity_unknown&&payload.equity_capital?Number(payload.equity_capital):null;payload.official_price=null;payload.next_follow_up_at=payload.next_follow_up_at||null;delete payload.next_contact_at;const q=id?state.client.from('customers').update(payload).eq('id',id):state.client.from('customers').insert(payload);const {error}=await q;if(error)return toast(error.message);$('#modal').close();toast('저장했습니다.');renderCustomers()};$('#modal').showModal();
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
  const el=$('#'+target);el.innerHTML=rows.length?`<div class="table-wrap listing-table-wrap"><table class="listing-table"><thead><tr>${adminMode?'<th class="select-col">선택</th>':''}<th>상태</th><th>거래</th><th>유형</th><th>매물명</th><th>지역</th><th>금액/월세</th><th>연락처</th><th>대출</th><th>전용면적</th><th>방/욕실</th><th>입주</th><th>담당</th><th>진행상황</th><th>최종 FU</th><th>예정 FU</th>${mine?'<th>관리</th>':''}</tr></thead><tbody>${rows.map(x=>`<tr>${adminMode?`<td class="select-col"><input type="checkbox" class="admin-listing-check" value="${x.id}" ${state.adminSelectedListings.has(x.id)?'checked':''} onchange="toggleAdminListingSelection('${x.id}',this.checked)"></td>`:''}<td class="crm3812-status-cell"><div class="crm3812-list-address" title="${escapeHtml(x.address||x.district||'주소 미입력')}">${escapeHtml(x.address||x.district||'주소 미입력')}</div>${badge(x.status==='available'?'거래 가능':x.status==='complete'?'거래 완료':'협의 중',x.status==='available'?'green':x.status==='complete'?'gray':'yellow')}</td><td>${escapeHtml(x.transaction_type)}</td><td>${escapeHtml(x.property_type)}</td><td class="listing-title-cell"><strong>${escapeHtml(x.title)}</strong>${x.is_public?'':' '+badge('비공개','red')}<br><button type="button" class="photo-link" onclick="openListingPhotos('${x.id}')">📷 내부사진</button></td><td>${escapeHtml(listingAreaText(x))}</td><td>${listingPriceText(x)}</td><td>${escapeHtml(x.contact_phone||'-')}</td><td>${x.loan_available===true?badge('O','green'):x.loan_available===false?badge('X','red'):badge('미확인','gray')}${x.loan_available===true&&x.official_price?`<br><span class="muted">기준 ${fmtMoney(x.official_price)}</span>`:''}</td><td>${x.area_m2?`${x.area_m2}㎡<br><span class="muted">약 ${(Number(x.area_m2)/3.3058).toFixed(2)}평</span>`:'-'}</td><td>${listingRoomText(x)} / ${x.bathroom_count!==null&&x.bathroom_count!==undefined?escapeHtml(String(x.bathroom_count)):'-'}</td><td>${moveInText(x)}</td><td>${escapeHtml(x.owner?.full_name||'-')}</td><td>${contractStage(x)}</td><td>${fmtDate(x.last_follow_up_at||x.last_confirmed_at)}</td><td>${dueBadge(x.next_follow_up_at)}</td>${mine?`<td><div class="row-actions"><button class="success" onclick="openFollowUpModal('listing','${x.id}')">FU</button><button class="ghost" onclick="openHistoryModal('listing','${x.id}')">히스토리</button><button class="ghost" onclick="openContractModal('listing','${x.id}')">진행상황</button><button class="ghost" onclick="openListingModal('${x.id}')">수정</button>${adminMode?`<button class="primary" onclick="openSingleListingTransfer('${x.id}')">개별 이관</button>`:''}<button class="danger" onclick="deleteListing('${x.id}')">삭제</button></div></td>`:''}</tr>`).join('')}</tbody></table></div>`:'<div class="empty">조건에 맞는 매물이 없습니다.</div>';
  if(adminMode) updateBulkTransferControls();
}
function openListingModal(id){
  const x=state.listings.find(v=>v.id===id)||{};$('#modalTitle').textContent=id?'매물 수정':'매물 등록';
  $('#modalBody').innerHTML=`<div class="form-grid"><label>매물명<input name="title" value="${escapeHtml(x.title||'')}" required></label><label>매도/임대인 연락처<input name="contact_phone" value="${escapeHtml(x.contact_phone||'')}" placeholder="010-0000-0000" required></label><label>거래 유형<select name="transaction_type"><option>매매</option><option>전세</option><option>월세</option></select></label><label>매물 유형<select name="property_type"><option>아파트</option><option>오피스텔</option><option>빌라</option><option>상가</option><option>사무실</option><option>토지</option></select></label><label>상태<select name="status"><option value="available">거래 가능</option><option value="hold">협의 중</option><option value="complete">거래 완료</option></select></label><label>지역<input name="district" value="${escapeHtml(x.district||'')}"></label><label class="span-2">주소<input name="address" value="${escapeHtml(x.address||'')}"></label><label>금액(만원)<input name="price" type="number" value="${x.price||''}"></label><label>월세(만원)<input name="monthly_rent" type="number" value="${x.monthly_rent||''}"></label><label>관리비(만원)<input name="management_fee" type="number" step="0.1" value="${x.management_fee??''}"></label><label>전용면적(㎡)<input id="listingAreaM2" name="area_m2" type="number" step="0.01" value="${x.area_m2||''}"><span id="listingAreaPyeong" class="field-help">${x.area_m2?`약 ${(Number(x.area_m2)/3.3058).toFixed(2)}평`:'㎡를 입력하면 평으로 자동 계산됩니다.'}</span></label><label>방 개수<div class="inline-field"><input id="listingRoomCountInput" name="room_count" type="number" min="0" step="1" value="${x.room_count??''}" placeholder="예: 3"><label class="inline-check"><input id="listingOnePointFiveCheck" name="is_one_point_five_room" type="checkbox" ${x.is_one_point_five_room?'checked':''}> 1.5룸</label></div></label><label>화장실 개수<input name="bathroom_count" type="number" min="0" step="1" value="${x.bathroom_count??''}" placeholder="예: 2"></label><label class="span-2">옵션<input name="options" value="${escapeHtml(x.options||'')}" placeholder="예: 에어컨, 냉장고, 세탁기, 붙박이장"></label><label>반려동물<select name="pet_allowed"><option>미확인</option><option>가능</option><option>불가</option><option>협의</option></select></label><label>대출 가능 여부<select id="listingLoanAvailable" name="loan_available"><option value="">미확인</option><option value="true">O</option><option value="false">X</option></select></label><label id="listingOfficialPriceWrap">공시지가/기준시가(만원)<input name="official_price" type="number" value="${x.official_price||''}"></label><label>입주 가능일<input id="moveInDateInput" name="move_in_date" type="date" value="${x.move_in_date||''}"></label><label class="check-label"><input id="moveInNegotiable" name="move_in_negotiable" type="checkbox" ${x.move_in_negotiable?'checked':''}> 협의 가능</label><label>예정 FU<input name="next_follow_up_at" type="date" value="${x.next_follow_up_at?x.next_follow_up_at.slice(0,10):''}"></label><label>공개 여부<select name="is_public"><option value="true">공개</option><option value="false">비공개</option></select></label><label>최종 확인일<input name="last_confirmed_at" type="date" value="${x.last_confirmed_at?x.last_confirmed_at.slice(0,10):''}"></label><label>다음 확인 예정일<input name="next_confirm_at" type="date" value="${x.next_confirm_at?x.next_confirm_at.slice(0,10):dateInDays(14)}"></label><details class="span-2 crm361-form-section" open><summary>매물 특징</summary><div class="crm36-check-grid crm361-feature-grid">${CRM36_LISTING_FEATURES.map(tag=>`<label class="inline-check"><input type="checkbox" class="crm361-feature-check" value="${tag}" ${crm36Array(x.feature_tags).includes(tag)?'checked':''}> ${tag}</label>`).join('')}</div><div class="field-help">자동추천 제외조건과 고객 역매칭에 사용됩니다.</div></details><label class="span-2">내부 사진 추가<input id="listingPhotoFiles" name="listing_photo_files" type="file" accept="image/*" multiple><span class="field-help">여러 장 선택 가능 · 사진 1장당 최대 10MB · 등록 후에도 사진 메뉴에서 추가/삭제 가능</span></label><label class="span-2">상세설명(비밀메모)<textarea name="description" rows="5" placeholder="중개사 내부에서만 확인하는 메모입니다.">${escapeHtml(x.description||'')}</textarea><span class="field-help">고객용 소개서와 카카오톡 추천문구에는 표시되지 않습니다.</span></label></div>`;
  ['transaction_type','property_type','status'].forEach(n=>$('#modalBody').querySelector(`[name=${n}]`).value=x[n]||({transaction_type:'매매',property_type:'아파트',status:'available'}[n]));$('#modalBody').querySelector('[name=is_public]').value=String(x.is_public!==false);$('#modalBody').querySelector('[name=pet_allowed]').value=x.pet_allowed||'미확인';const listingLoan=$('#listingLoanAvailable');listingLoan.value=x.loan_available===true?'true':x.loan_available===false?'false':'';const toggleListingOfficial=()=>{$('#listingOfficialPriceWrap').style.display=listingLoan.value==='true'?'':'none'};listingLoan.onchange=toggleListingOfficial;toggleListingOfficial();const listingRoomInput=$('#listingRoomCountInput'),listingOnePointFive=$('#listingOnePointFiveCheck');const syncListingOnePointFive=()=>{if(listingOnePointFive.checked){listingRoomInput.value='1';listingRoomInput.disabled=true}else listingRoomInput.disabled=false};listingOnePointFive.onchange=syncListingOnePointFive;syncListingOnePointFive();
  $('#modalSubmit').onclick=async(e)=>{e.preventDefault();const fd=new FormData($('#modalForm'));const p=Object.fromEntries(fd.entries());p.owner_id=id?(x.owner_id||state.profile.id):state.profile.id;p.is_public=p.is_public==='true';['price','monthly_rent','management_fee','area_m2','room_count','bathroom_count'].forEach(k=>p[k]=p[k]?Number(p[k]):null);p.is_one_point_five_room=fd.get('is_one_point_five_room')==='on';if(p.is_one_point_five_room)p.room_count=1;p.loan_available=p.loan_available===''?null:p.loan_available==='true';p.official_price=p.loan_available===true&&p.official_price?Number(p.official_price):null;p.move_in_negotiable=fd.get('move_in_negotiable')==='on';p.move_in_date=p.move_in_negotiable?null:(p.move_in_date||null);p.next_follow_up_at=p.next_follow_up_at||null;p.last_confirmed_at=p.last_confirmed_at||new Date().toISOString().slice(0,10);p.next_confirm_at=p.next_confirm_at||null;p.feature_tags=[...$('#modalBody').querySelectorAll('.crm361-feature-check:checked')].map(el=>el.value);delete p.listing_photo_files;
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
  const contractSteps=[
    ['가계약',item?.provisional_contract_date,!!item?.provisional_contract_completed,false],
    ['본계약',item?.contract_date,!!item?.contract_completed,false],
    ['중도금',item?.interim_payment_date,!!item?.interim_payment_completed,!!item?.interim_payment_not_applicable],
    ['잔금',item?.final_payment_date,!!item?.final_payment_completed,false]
  ];
  $('#modalBody').innerHTML=`<div class="history-layout"><section><div class="contract-strip">${contractSteps.map(([n,d,completed,na])=>`<div class="contract-step ${completed?'done':''} ${na?'not-applicable':''}"><span>${n}</span><strong>${na?'해당없음':d?fmtDate(d):'미정'}</strong></div>`).join('')}</div></section><section>${(data||[]).length?`<div class="history-list">${data.map(h=>`<article class="history-item"><div class="history-head"><div><span class="history-type">${escapeHtml(h.contact_method)}</span> <strong>${fmtDate(h.follow_up_date)}</strong></div><div class="history-actions"><span class="muted">${escapeHtml(h.writer?.full_name||'')}</span>${(h.created_by===state.profile.id||state.profile.role==='admin')?`<button type="button" class="history-delete" onclick="deleteHistoryItem('${h.id}','${entityType}','${id}')">삭제</button>`:''}</div></div><p>${escapeHtml(h.content).replace(/\n/g,'<br>')}</p>${h.next_follow_up_at?`<div class="next-fu">예정 FU · ${fmtDate(h.next_follow_up_at)}</div>`:''}</article>`).join('')}</div>`:'<div class="empty">아직 기록된 상담 히스토리가 없습니다.</div>'}</section></div>`;
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
$('#saveSetupBtn').onclick=()=>{location.reload()};
$('#clearSetupBtn').onclick=()=>{toast('Supabase 연결정보는 앱에 기본 설정되어 있습니다.')};
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
    const titles={smartMatch:['고객·매물 자동매칭','지역과 무관하게 방 개수·금액 중심으로 추천'],globalSearch:['통합검색','고객·매물·연락처·주소·메모를 한 번에 검색'],documents:['계약서류','계약 관련 파일을 담당자와 관리자만 관리'],adminStats:['중개사 업무 통계','중개사별 고객·매물·계약·FU 현황'],auditLogs:['변경 기록','고객과 매물의 등록·수정·삭제 이력'],customerTransfer:['고객 선택 일괄 이관','여러 고객을 체크해 한 번에 담당자 변경'],adminData:['엑셀 데이터 관리','관리자만 고객·매물 엑셀 가져오기와 내보내기 가능']};
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
function roomMatches(customer,listing){
  const wanted=customerRoomValue(customer);
  if(!wanted)return true;
  return listingRoomValue(listing)>=wanted;
}
function ratioPercent(actual,base){
  if(!base)return 0;
  return Math.round((actual/base)*1000)/10;
}
function evaluateListingMatch(customer,listing){
  const customerTypes=customerDealTypes(customer);
  const budget=moneyNumber(customer.budget_max);
  const wantedRent=moneyNumber(customer.desired_monthly_rent);
  const listingPrice=moneyNumber(listing.price);
  const listingRent=moneyNumber(listing.monthly_rent);
  const reasons=[];

  // 지역은 자동매칭 조건에서 제외하고 참고정보로만 표시한다.
  if(!roomMatches(customer,listing))return {matched:false,reasons:[`방 개수 부족: 희망 ${customerRoomText(customer)} / 매물 ${listingRoomText(listing)}`]};
  if(customerRoomValue(customer))reasons.push(`방 개수 충족: 희망 ${customerRoomText(customer)} / 매물 ${listingRoomText(listing)}`);
  else reasons.push('희망 방 개수 미입력: 금액 기준으로 추천');

  // 매매 고객: 희망금액의 120% 이하 매매 매물
  if(customerTypes.includes('매매')&&listing.transaction_type==='매매'){
    const ceiling=budget?budget*1.2:0;
    if(ceiling&&listingPrice>ceiling)return {matched:false,reasons:['매매금액 120% 한도 초과']};
    reasons.push(`매매금액 ${fmtMoney(listingPrice)}${budget?` / 희망 ${fmtMoney(budget)}의 ${ratioPercent(listingPrice,budget)}%`:''}`);
    if(budget)reasons.push(`추천 한도 ${fmtMoney(Math.round(ceiling))} 이내`);
    return {matched:true,category:'추천',matchKind:'direct',reasons,sortValue:budget?Math.abs(listingPrice-budget):listingPrice};
  }

  // 전세 고객: 전세는 희망금액의 120% 이하
  if(customerTypes.includes('전세')&&listing.transaction_type==='전세'){
    const ceiling=budget?budget*1.2:0;
    if(ceiling&&listingPrice>ceiling)return {matched:false,reasons:['전세금 120% 한도 초과']};
    reasons.push(`전세금 ${fmtMoney(listingPrice)}${budget?` / 희망 ${fmtMoney(budget)}의 ${ratioPercent(listingPrice,budget)}%`:''}`);
    if(budget)reasons.push(`추천 한도 ${fmtMoney(Math.round(ceiling))} 이내`);
    return {matched:true,category:'추천',matchKind:'direct',reasons,sortValue:budget?Math.abs(listingPrice-budget):listingPrice};
  }

  // 전세 고객에게 월세 대체 추천
  // 월세를 전세금처럼 비교하기 위해 '보증금 + 월세×100'으로 간편 환산한다.
  // 예: 전세 희망 15,000만원 ↔ 월세 12,000/30은 12,000 + 30×100 = 15,000만원으로 추천.
  if(customerTypes.includes('전세')&&listing.transaction_type==='월세'){
    const converted=listingPrice+(listingRent*100);
    const ceiling=budget?budget*1.2:0;
    if(ceiling&&converted>ceiling)return {matched:false,reasons:['월세 전세환산금액이 희망 전세금 120% 한도 초과']};
    reasons.push('전세 고객에게 월세 매물 대체 추천');
    reasons.push(`월세 전세환산: 보증금 ${fmtMoney(listingPrice)} + 월세 ${fmtMoney(listingRent)}×100 = ${fmtMoney(converted)}`);
    if(budget){
      reasons.push(`희망 전세금 ${fmtMoney(budget)}의 ${ratioPercent(converted,budget)}%`);
      reasons.push(`추천 한도 ${fmtMoney(Math.round(ceiling))} 이내`);
    }
    return {matched:true,category:'대체 추천',matchKind:'alternative',reasons,sortValue:budget?Math.abs(converted-budget):converted};
  }

  // 월세 고객: 보증금 120% 이하 + 월차임 130% 이하
  if(customerTypes.includes('월세')&&listing.transaction_type==='월세'){
    const depositCeiling=budget?budget*1.2:0;
    const rentCeiling=wantedRent?wantedRent*1.3:0;
    if(depositCeiling&&listingPrice>depositCeiling)return {matched:false,reasons:['월세 보증금 120% 한도 초과']};
    if(rentCeiling&&listingRent>rentCeiling)return {matched:false,reasons:['월차임 130% 한도 초과']};
    reasons.push(`보증금 ${fmtMoney(listingPrice)}${budget?` / 희망 ${fmtMoney(budget)}의 ${ratioPercent(listingPrice,budget)}%`:''}`);
    reasons.push(`월차임 ${fmtMoney(listingRent)}${wantedRent?` / 희망 ${fmtMoney(wantedRent)}의 ${ratioPercent(listingRent,wantedRent)}%`:''}`);
    if(budget)reasons.push(`보증금 한도 ${fmtMoney(Math.round(depositCeiling))} 이내`);
    if(wantedRent)reasons.push(`월차임 한도 ${fmtMoney(Math.round(rentCeiling))} 이내`);
    return {matched:true,category:'추천',matchKind:'direct',reasons,sortValue:(budget?Math.abs(listingPrice-budget):listingPrice)+(wantedRent?Math.abs(listingRent-wantedRent)*100:0)};
  }

  // 월세 고객에게 전세 대체 추천: 희망 보증금 + 희망 월세×100을 전세환산한 뒤 120% 이하
  if(customerTypes.includes('월세')&&listing.transaction_type==='전세'){
    const converted=budget+(wantedRent*100);
    const ceiling=converted?converted*1.2:0;
    if(ceiling&&listingPrice>ceiling)return {matched:false,reasons:['전세금이 월세 전세환산 한도 초과']};
    reasons.push('월세 고객에게 전세 매물 대체 추천');
    if(converted){
      reasons.push(`월세 조건 전세환산: 보증금 ${fmtMoney(budget)} + 월세 ${fmtMoney(wantedRent)}×100 = ${fmtMoney(converted)}`);
      reasons.push(`매물 전세금 ${fmtMoney(listingPrice)} / 환산 한도의 ${ratioPercent(listingPrice,converted)}%`);
      reasons.push(`추천 한도 ${fmtMoney(Math.round(ceiling))} 이내`);
    }else{
      reasons.push(`매물 전세금 ${fmtMoney(listingPrice)}`);
    }
    return {matched:true,category:'대체 추천',matchKind:'alternative',reasons,sortValue:converted?Math.abs(listingPrice-converted):listingPrice};
  }

  return {matched:false,reasons:['거래유형 불일치']};
}
async function renderSmartMatch(){
  await Promise.all([loadCustomers(),loadListings()]);
  const demand=state.customers.filter(x=>['매수','임차'].includes(x.customer_type));
  $('#content').innerHTML=`<div class="panel"><div class="notice"><strong>간편 추천 기준</strong><br>지역은 추천 조건에서 제외하고 <b>방 개수와 금액</b>을 중심으로 추천합니다. 매매·전세는 희망금액의 120%까지, 월세는 보증금 120%와 월차임 130%까지 추천합니다. 전세 고객에게 월세를 추천할 때는 보증금+월세×100으로 전세환산하고, 월세 고객에게 전세도 대체 추천합니다. 추천 사유는 중개사 화면에서만 보이며 고객용 소개서에는 포함되지 않습니다.</div><div class="filters" style="margin-top:16px"><select id="matchCustomer" onchange="showCustomerMatches()"><option value="">고객 선택</option>${demand.map(x=>`<option value="${x.id}">${escapeHtml(x.name)} · ${escapeHtml(x.deal_type||x.customer_type)} · 방 ${customerRoomText(x)} · ${fmtMoney(x.budget_max)}</option>`).join('')}</select><button class="ghost" onclick="renderView('customers')">고객 관리</button></div><div id="matchResults" class="empty">고객을 선택하면 방 개수와 금액 조건에 맞는 공개 매물을 추천합니다.</div></div>`;
}
async function showCustomerMatches(){
  const customer=state.customers.find(x=>x.id===$('#matchCustomer').value);if(!customer)return;
  state.matchSelection.clear();
  const rows=state.listings.filter(x=>x.is_public&&x.status==='available').map(x=>({...x,_match:evaluateListingMatch(customer,x)})).filter(x=>x._match.matched).sort((a,b)=>{
    if(a._match.matchKind!==b._match.matchKind)return a._match.matchKind==='direct'?-1:1;
    const roomA=Math.max(0,listingRoomValue(a)-customerRoomValue(customer));
    const roomB=Math.max(0,listingRoomValue(b)-customerRoomValue(customer));
    if(roomA!==roomB)return roomA-roomB;
    return (a._match.sortValue||0)-(b._match.sortValue||0);
  });
  $('#matchResults').innerHTML=`<div class="match-toolbar"><strong>${escapeHtml(customer.name)} 추천 매물 ${rows.length}개</strong><button class="primary" onclick="printSelectedListingBrochure('${customer.id}')">선택 매물 소개서 인쇄/PDF</button></div>${rows.length?`<div class="match-grid">${rows.map(x=>`<article class="match-card ${x._match.matchKind==='alternative'?'alternative-match':''}"><label class="check-label"><input type="checkbox" onchange="toggleMatchSelection('${x.id}',this.checked)"> 소개서 선택</label><div class="match-type ${x._match.matchKind==='alternative'?'alternative':''}">${escapeHtml(x._match.category)}</div><h3>${escapeHtml(x.title)}</h3><div class="match-reason"><strong>중개사 추천 사유</strong>${x._match.reasons.map(r=>`<div>• ${escapeHtml(r)}</div>`).join('')}</div><p>${escapeHtml(x.district||'')} · ${escapeHtml(x.transaction_type)} · ${listingPriceText(x)}</p><p>방 ${listingRoomText(x)} / 욕실 ${x.bathroom_count??'-'}</p><button class="ghost" onclick="openListingPhotos('${x.id}')">사진 보기</button></article>`).join('')}</div>`:'<div class="empty">현재 방 개수와 금액 조건에 맞는 공개 매물이 없습니다.</div>'}`;
}
function toggleMatchSelection(id,checked){checked?state.matchSelection.add(id):state.matchSelection.delete(id)}
async function printSelectedListingBrochure(customerId){
  const customer=state.customers.find(x=>x.id===customerId),rows=state.listings.filter(x=>state.matchSelection.has(x.id));if(!rows.length)return toast('소개서에 넣을 매물을 선택하세요.');
  const w=window.open('','_blank');
  const cards=[];for(const x of rows){const {data:photos}=await state.client.from('listing_photos').select('*').eq('listing_id',x.id).eq('is_customer_visible',true).order('sort_order');let image='';const cover=(photos||[]).find(p=>p.id===x.cover_photo_id)||(photos||[])[0];if(cover)image=await signedPhotoUrl(cover.storage_path)||'';cards.push(`<section class="property">${image?`<img src="${image}">`:''}<h2>${escapeHtml(x.title)}</h2><p><b>${escapeHtml(x.transaction_type)}</b> ${listingPriceText(x)}</p><p>${escapeHtml(x.district||'')} ${escapeHtml(x.address||'')}</p><p>전용면적 ${x.area_m2||'-'}㎡${x.area_m2?` (약 ${(Number(x.area_m2)/3.3058).toFixed(2)}평)`:''} · 방 ${listingRoomText(x)} · 욕실 ${x.bathroom_count??'-'}</p><p>${escapeHtml(x.description||'')}</p></section>`)}
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
function exportCustomersExcel(){if(state.profile.role!=='admin')return toast('관리자만 엑셀 내보내기를 사용할 수 있습니다.');exportRowsExcel(state.customers.map(x=>({고객명:x.name,연락처:x.phone,구분:x.customer_type,거래유형:x.deal_type,등급:x.customer_grade,희망지역:x.preferred_area,희망금액만원:x.budget_max,희망월세만원:x.desired_monthly_rent,희망방개수:x.desired_rooms,'희망1.5룸':x.desired_one_point_five_room?'O':'X',상태:x.status,메모:x.notes})),'고객목록.xlsx')}
function exportListingsExcel(){if(state.profile.role!=='admin')return toast('관리자만 엑셀 내보내기를 사용할 수 있습니다.');exportRowsExcel(state.listings.map(x=>({담당중개사:x.owner?.full_name||'',매물명:x.title,거래유형:x.transaction_type,부동산유형:x.property_type,주소:x.address,가격만원:x.price,월세만원:x.monthly_rent,'면적㎡':x.area_m2,방:x.room_count,'1.5룸':x.is_one_point_five_room?'O':'X',화장실:x.bathroom_count,연락처:x.contact_phone,공개:x.is_public?'공개':'비공개',상태:x.status,설명:x.description})),'전체매물목록.xlsx')}
function openExcelImport(kind){const input=document.createElement('input');input.type='file';input.accept='.xlsx,.xls,.csv';input.onchange=()=>importExcelFile(kind,input.files[0]);input.click()}
async function importExcelFile(kind,file){if(state.profile.role!=='admin')return toast('관리자만 엑셀 가져오기를 사용할 수 있습니다.');if(!file)return;const importOwner=$('#excelImportOwner')?.value||state.profile.id;const buf=await file.arrayBuffer(),wb=XLSX.read(buf),rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);if(!rows.length)return toast('가져올 데이터가 없습니다.');let payload;if(kind==='customer')payload=rows.map(r=>({owner_id:importOwner,original_owner_id:importOwner,name:r.고객명||r.name,phone:r.연락처||r.phone,customer_type:r.구분||r.customer_type||'매수',deal_type:r.거래유형||r.deal_type||'매매',customer_grade:r.등급||r.customer_grade||'C',preferred_area:r.희망지역||r.preferred_area,budget_max:r.희망금액만원||r.budget_max||null,desired_monthly_rent:r.희망월세만원||null,desired_rooms:r.희망방개수||null,desired_one_point_five_room:String(r['희망1.5룸']||'X').toUpperCase()==='O',status:r.상태||'신규',notes:r.메모||''})).filter(x=>x.name);else payload=rows.map(r=>({owner_id:importOwner,original_owner_id:importOwner,title:r.매물명||r.title,transaction_type:r.거래유형||'매매',property_type:r.부동산유형||'아파트',address:r.주소||'',price:r.가격만원||null,monthly_rent:r.월세만원||null,area_m2:r['면적㎡']||null,room_count:r.방||null,is_one_point_five_room:String(r['1.5룸']||'X').toUpperCase()==='O',bathroom_count:r.화장실||null,contact_phone:r.연락처||'',is_public:String(r.공개||'공개')!=='비공개',status:r.상태||'available',description:r.설명||''})).filter(x=>x.title);const {error}=await state.client.from(kind==='customer'?'customers':'listings').insert(payload);if(error)return toast(error.message);toast(`${payload.length}건을 가져왔습니다.`);kind==='customer'?renderCustomers():renderMyListings()}

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

console.info('CRM v3.5 전월세 환산 자동매칭 로드 완료');

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
    희망방개수:x.desired_rooms,'희망1.5룸':x.desired_one_point_five_room?'O':'X',대출여부:x.loan_status,자기자본금만원:x.equity_amount,
    자기자본금모름:x.equity_unknown?'모름':'',상태:x.status,메모:x.notes
  };
}
function listingExcelRow(x){
  return {
    담당중개사:excelOwnerName(x.owner_id),매물명:x.title,거래유형:x.transaction_type,
    부동산유형:x.property_type,주소:x.address,가격만원:x.price,월세만원:x.monthly_rent,
    '면적㎡':x.area_m2,방:x.room_count,'1.5룸':x.is_one_point_five_room?'O':'X',화장실:x.bathroom_count,연락처:x.contact_phone,
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
    ${rows.map(x=>type==='customer'?`<tr><td><input type="checkbox" ${set.has(x.id)?'checked':''} onchange="toggleAdminExcelRow('customer','${x.id}',this.checked)"></td><td><strong>${escapeHtml(x.name)}</strong></td><td>${escapeHtml(x.phone||'-')}</td><td>${escapeHtml(x.customer_type||'-')}</td><td>${escapeHtml(x.deal_type||'-')}</td><td>${escapeHtml(x.preferred_area||'-')}</td><td>${customerBudgetText(x)}</td><td>${escapeHtml(x.status||'-')}</td></tr>`:`<tr><td><input type="checkbox" ${set.has(x.id)?'checked':''} onchange="toggleAdminExcelRow('listing','${x.id}',this.checked)"></td><td><strong>${escapeHtml(x.title)}</strong></td><td>${escapeHtml(x.transaction_type||'-')}</td><td>${escapeHtml(x.address||'-')}</td><td>${listingPriceText(x)}</td><td>${listingRoomText(x)} / ${x.bathroom_count??'-'}</td><td>${x.is_public?'공개':'비공개'}</td><td>${escapeHtml(x.status||'-')}</td></tr>`).join('')||`<tr><td colspan="8"><div class="empty">해당 중개사의 ${type==='customer'?'고객':'매물'}이 없습니다.</div></td></tr>`}
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
    const parsed=kind==='customer'?raw.map((r,i)=>({rowNo:i+2,data:{name:r.고객명||r.name,phone:r.연락처||r.phone,customer_type:r.구분||r.customer_type||'매수',deal_type:r.거래유형||r.deal_type||'매매',customer_grade:r.등급||r.customer_grade||'C',preferred_area:r.희망지역||r.preferred_area,budget_max:r.희망금액만원||r.budget_max||null,desired_monthly_rent:r.희망월세만원||r.desired_monthly_rent||null,desired_rooms:r.희망방개수||r.desired_rooms||null,desired_one_point_five_room:String(r['희망1.5룸']||r.desired_one_point_five_room||'X').toUpperCase()==='O',status:r.상태||'신규',notes:r.메모||''},valid:!!(r.고객명||r.name),label:r.고객명||r.name||'(고객명 없음)' }))
      :raw.map((r,i)=>({rowNo:i+2,data:{title:r.매물명||r.title,transaction_type:r.거래유형||r.transaction_type||'매매',property_type:r.부동산유형||r.property_type||'아파트',address:r.주소||r.address||'',price:r.가격만원||r.price||null,monthly_rent:r.월세만원||r.monthly_rent||null,area_m2:r['면적㎡']||r.area_m2||null,room_count:r.방||r.room_count||null,is_one_point_five_room:String(r['1.5룸']||r.is_one_point_five_room||'X').toUpperCase()==='O',bathroom_count:r.화장실||r.bathroom_count||null,contact_phone:r.연락처||r.contact_phone||'',is_public:String(r.공개||'공개')!=='비공개',status:r.상태||'available',description:r.설명||''},valid:!!(r.매물명||r.title),label:r.매물명||r.title||'(매물명 없음)'}));
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

/* ================= CRM v3.6 영업 FU·역매칭·알림 ================= */
state.savedRecommendations=[];

const CRM36_EXCLUSION_OPTIONS=['반지하 제외','옥탑 제외','1층 제외','엘리베이터 필수','주차 필수','반려동물 가능 필수'];
const CRM36_LISTING_FEATURES=['반지하','옥탑','1층','엘리베이터','주차','반려동물 가능'];
function crm36Array(v){return Array.isArray(v)?v:[]}
function crm36FeatureMap(tags){const s=new Set(crm36Array(tags));return {basement:s.has('반지하'),rooftop:s.has('옥탑'),first:s.has('1층'),elevator:s.has('엘리베이터'),parking:s.has('주차'),pet:s.has('반려동물 가능')}}
function crm36PassExclusions(customer,listing){
  const e=new Set(crm36Array(customer.recommendation_exclusions)),f=crm36FeatureMap(listing.feature_tags);
  const fail=[];
  if(e.has('반지하 제외')&&f.basement)fail.push('반지하 제외 조건');
  if(e.has('옥탑 제외')&&f.rooftop)fail.push('옥탑 제외 조건');
  if(e.has('1층 제외')&&f.first)fail.push('1층 제외 조건');
  if(e.has('엘리베이터 필수')&&!f.elevator)fail.push('엘리베이터 없음');
  if(e.has('주차 필수')&&!f.parking)fail.push('주차 불가');
  if(e.has('반려동물 가능 필수')&&!f.pet)fail.push('반려동물 가능 미확인');
  return {ok:!fail.length,fail};
}

const crm36BaseEvaluate=evaluateListingMatch;
evaluateListingMatch=function(customer,listing){
  const exclusion=crm36PassExclusions(customer,listing);
  if(!exclusion.ok)return {matched:false,reasons:exclusion.fail};
  return crm36BaseEvaluate(customer,listing);
};

async function crm36LoadRecommendations(customerId){
  let q=state.client.from('customer_listing_recommendations').select('*, listing:listings(*), creator:profiles!customer_listing_recommendations_created_by_fkey(full_name)').order('created_at',{ascending:false});
  if(customerId)q=q.eq('customer_id',customerId);
  const {data,error}=await q;if(error){toast(error.message);return []}return data||[];
}
async function crm36SaveRecommendation(customerId,listingId){
  const existing=await state.client.from('customer_listing_recommendations').select('id').eq('customer_id',customerId).eq('listing_id',listingId).maybeSingle();
  if(existing.data)return toast('이미 이 고객에게 저장된 추천 매물입니다.');
  const row={customer_id:customerId,listing_id:listingId,created_by:state.profile.id,reaction_status:'추천함'};
  const {error}=await state.client.from('customer_listing_recommendations').insert(row);if(error)return toast(error.message);
  await state.client.from('interaction_history').insert({created_by:state.profile.id,follow_up_date:today(),contact_method:'매물추천',content:`추천 매물 저장: ${state.listings.find(x=>x.id===listingId)?.title||'매물'}`,customer_id:customerId});
  toast('추천 매물을 FU에 저장했습니다.');
}
async function crm36SetReaction(id,customerId){
  const row=state.savedRecommendations.find(x=>x.id===id)||{};
  $('#modalTitle').textContent='고객 반응·방문 일정';
  $('#modalBody').innerHTML=`<div class="form-grid"><label>고객 반응<select id="crm36Reaction">${['추천함','관심 있음','방문 희망','가격 부담','방 개수 부족','월세 부담','위치 불만','거절','보류','계약 검토'].map(x=>`<option ${row.reaction_status===x?'selected':''}>${x}</option>`).join('')}</select></label><label>방문 상태<select id="crm36VisitStatus"><option value="">미등록</option>${['방문 예정','방문 완료','일정 변경','방문 취소'].map(x=>`<option ${row.visit_status===x?'selected':''}>${x}</option>`).join('')}</select></label><label>방문 날짜·시간<input id="crm36VisitAt" type="datetime-local" value="${row.visit_at?new Date(row.visit_at).toISOString().slice(0,16):''}"></label><label class="span-2">고객 반응·방문 결과<textarea id="crm36ReactionNote" rows="6" placeholder="고객이 좋게 본 점, 부담스러운 점, 다음 제안 방향 등을 기록하세요.">${escapeHtml(row.reaction_note||row.visit_result||'')}</textarea></label></div>`;
  $('#modalSubmit').style.display='';$('#modalSubmit').onclick=async e=>{e.preventDefault();const payload={reaction_status:$('#crm36Reaction').value,reaction_note:$('#crm36ReactionNote').value||null,visit_status:$('#crm36VisitStatus').value||null,visit_at:$('#crm36VisitAt').value?new Date($('#crm36VisitAt').value).toISOString():null,visit_result:$('#crm36ReactionNote').value||null,updated_at:new Date().toISOString()};const {error}=await state.client.from('customer_listing_recommendations').update(payload).eq('id',id);if(error)return toast(error.message);const listingTitle=row.listing?.title||'추천 매물';const details=[`고객 반응: ${payload.reaction_status}`,payload.visit_status?`방문 상태: ${payload.visit_status}`:'',payload.visit_at?`방문 일정: ${new Date(payload.visit_at).toLocaleString('ko-KR')}`:'',payload.reaction_note?`내용: ${payload.reaction_note}`:''].filter(Boolean).join('\n');await state.client.from('interaction_history').insert({created_by:state.profile.id,follow_up_date:today(),contact_method:payload.visit_status?'방문일정':'추천반응',content:`${listingTitle}\n${details}`,customer_id:customerId});$('#modal').close();toast('FU에 고객 반응과 방문 일정을 저장했습니다.');openHistoryModal('customer',customerId)};$('#modal').showModal();
}
async function crm36DeleteRecommendation(id,customerId){if(!confirm('이 추천 기록을 삭제할까요?'))return;const {error}=await state.client.from('customer_listing_recommendations').delete().eq('id',id);if(error)return toast(error.message);toast('추천 기록을 삭제했습니다.');openHistoryModal('customer',customerId)}

const crm36BaseHistory=openHistoryModal;
openHistoryModal=async function(entityType,id){
  await crm36BaseHistory(entityType,id);
  if(entityType!=='customer')return;
  state.savedRecommendations=await crm36LoadRecommendations(id);
  const body=$('#modalBody');if(!body)return;
  const section=document.createElement('section');section.className='crm36-fu-recommendations';
  section.innerHTML=`<div class="panel-head"><div><h3>추천 매물·고객 반응·방문 일정</h3><div class="muted">추천 이후 반응과 방문 결과를 FU와 함께 관리합니다.</div></div></div>${state.savedRecommendations.length?`<div class="crm36-recommendation-list">${state.savedRecommendations.map(r=>`<article class="crm36-recommendation-item"><div><strong>${escapeHtml(r.listing?.title||'삭제된 매물')}</strong><div class="muted">${escapeHtml(r.listing?.transaction_type||'')} ${r.listing?listingPriceText(r.listing):''} · ${fmtDate(r.created_at)}</div><div class="crm36-status-line">${badge(r.reaction_status||'추천함','blue')} ${r.visit_status?badge(r.visit_status,r.visit_status==='방문 완료'?'green':'yellow'):''}</div>${r.visit_at?`<div class="next-fu">방문 일정 · ${new Date(r.visit_at).toLocaleString('ko-KR')}</div>`:''}${r.reaction_note?`<p>${escapeHtml(r.reaction_note).replace(/\n/g,'<br>')}</p>`:''}</div><div class="row-actions"><button class="primary" onclick="crm36SetReaction('${r.id}','${id}')">반응·방문 관리</button><button class="danger" onclick="crm36DeleteRecommendation('${r.id}','${id}')">삭제</button></div></article>`).join('')}</div>`:'<div class="empty">저장된 추천 매물이 없습니다.</div>'}`;
  body.prepend(section);
};

const crm36BaseShowMatches=showCustomerMatches;
showCustomerMatches=async function(){
  await crm36BaseShowMatches();
  const customerId=$('#matchCustomer')?.value;if(!customerId)return;
  $$('#matchResults .match-card').forEach((card,i)=>{const check=card.querySelector('input[type=checkbox]');const listingId=check?.getAttribute('onchange')?.match(/'([^']+)'/)?.[1];if(!listingId)return;const actions=document.createElement('div');actions.className='row-actions crm36-match-actions';actions.innerHTML=`<button class="success" onclick="crm36SaveRecommendation('${customerId}','${listingId}')">FU에 추천 저장</button><button class="ghost" onclick="crm36QuickVisit('${customerId}','${listingId}')">방문 일정</button>`;card.appendChild(actions)});
  const toolbar=$('#matchResults .match-toolbar');if(toolbar)toolbar.insertAdjacentHTML('beforeend',`<button class="success" onclick="crm36KakaoMessage('${customerId}')">카카오톡 추천문구</button>`);
};
async function crm36QuickVisit(customerId,listingId){
  const {data,error}=await state.client.from('customer_listing_recommendations').select('*').eq('customer_id',customerId).eq('listing_id',listingId).maybeSingle();if(error)return toast(error.message);
  if(data){state.savedRecommendations=[{...data,listing:state.listings.find(x=>x.id===listingId)}];return crm36SetReaction(data.id,customerId)}
  const {data:inserted,error:insertError}=await state.client.from('customer_listing_recommendations').insert({customer_id:customerId,listing_id:listingId,created_by:state.profile.id,reaction_status:'방문 희망'}).select().single();if(insertError)return toast(insertError.message);state.savedRecommendations=[{...inserted,listing:state.listings.find(x=>x.id===listingId)}];crm36SetReaction(inserted.id,customerId)
}
function crm36KakaoMessage(customerId){
  const customer=state.customers.find(x=>x.id===customerId);const rows=state.listings.filter(x=>state.matchSelection.has(x.id));if(!rows.length)return toast('카카오톡 문구에 넣을 매물을 먼저 체크하세요.');
  const lines=[`안녕하세요, ${customer.name} 고객님.`,`말씀해주신 조건을 기준으로 현재 확인 가능한 매물 중 비교해보실 만한 매물을 정리해드렸습니다.`,``,`[고객님 희망 조건]`,`• 거래유형: ${customer.deal_type||customer.customer_type}`,`• 희망금액: ${fmtMoney(customer.budget_max)}`,`• 희망 방 개수: ${customerRoomText(customer)}`,customer.desired_monthly_rent?`• 희망 월세: 월 ${fmtMoney(customer.desired_monthly_rent)}`:'',``,`[추천 매물 ${rows.length}건]`].filter(Boolean);
  rows.forEach((x,i)=>{lines.push(``,`${i+1}. ${x.title}`,`• 거래조건: ${x.transaction_type} ${listingPriceText(x)}`,`• 구조: 방 ${listingRoomText(x)} / 욕실 ${x.bathroom_count??'-'}개`,x.area_m2?`• 면적: ${x.area_m2}㎡`:'',x.district||x.address?`• 위치: ${[x.district,x.address].filter(Boolean).join(' ')}`:'',x.move_in_date?`• 입주 가능일: ${fmtDate(x.move_in_date)}`:'',x.description?`• 매물 특징: ${x.description}`:'').filter(Boolean)});
  lines.push(``,`※ 매물은 실시간으로 계약되거나 조건이 변경될 수 있어 방문 전 현재 상태를 다시 확인해드리겠습니다.`,`관심 가는 매물 번호를 말씀해주시면 내부사진과 상세조건을 추가로 안내드리고, 가능한 시간에 맞춰 방문 일정도 잡아드리겠습니다.`,``,`담당 중개사: ${state.profile.full_name||''}`,state.profile.office_name?`소속: ${state.profile.office_name}`:'',state.profile.phone?`연락처: ${state.profile.phone}`:'');
  const text=lines.filter(Boolean).join('\n');$('#modalTitle').textContent='카카오톡 추천 문구';$('#modalBody').innerHTML=`<textarea id="crm36KakaoText" rows="22" style="width:100%">${escapeHtml(text)}</textarea><div class="notice" style="margin-top:12px">고객에게 보내기 전에 실시간 거래 가능 여부와 금액 변동을 다시 확인하세요.</div>`;$('#modalSubmit').textContent='문구 복사';$('#modalSubmit').style.display='';$('#modalSubmit').onclick=async e=>{e.preventDefault();await navigator.clipboard.writeText($('#crm36KakaoText').value);toast('카카오톡 문구를 복사했습니다.');$('#modal').close()};const reset=()=>{$('#modalSubmit').textContent='저장';$('#modal').removeEventListener('close',reset)};$('#modal').addEventListener('close',reset);$('#modal').showModal();
}

async function crm36OpenCustomerExclusions(customerId){const c=state.customers.find(x=>x.id===customerId);const selected=new Set(crm36Array(c.recommendation_exclusions));$('#modalTitle').textContent=`${c.name} · 추천 제외 조건`;$('#modalBody').innerHTML=`<p class="muted">선택한 조건에 맞지 않는 매물은 자동추천과 역매칭에서 제외됩니다.</p><div class="crm36-check-grid">${CRM36_EXCLUSION_OPTIONS.map(x=>`<label class="inline-check"><input type="checkbox" value="${x}" ${selected.has(x)?'checked':''}> ${x}</label>`).join('')}</div>`;$('#modalSubmit').style.display='';$('#modalSubmit').onclick=async e=>{e.preventDefault();const tags=[...$('#modalBody input:checked')].map(x=>x.value);const {error}=await state.client.from('customers').update({recommendation_exclusions:tags}).eq('id',customerId);if(error)return toast(error.message);$('#modal').close();toast('추천 제외 조건을 저장했습니다.');renderCustomers()};$('#modal').showModal()}
async function crm36OpenListingFeatures(listingId){const l=state.listings.find(x=>x.id===listingId);const selected=new Set(crm36Array(l.feature_tags));$('#modalTitle').textContent=`${l.title} · 매물 특징`;$('#modalBody').innerHTML=`<p class="muted">추천 제외조건 판단에 사용될 매물 특징을 체크하세요.</p><div class="crm36-check-grid">${CRM36_LISTING_FEATURES.map(x=>`<label class="inline-check"><input type="checkbox" value="${x}" ${selected.has(x)?'checked':''}> ${x}</label>`).join('')}</div>`;$('#modalSubmit').style.display='';$('#modalSubmit').onclick=async e=>{e.preventDefault();const tags=[...$('#modalBody input:checked')].map(x=>x.value);const {error}=await state.client.from('listings').update({feature_tags:tags}).eq('id',listingId);if(error)return toast(error.message);$('#modal').close();toast('매물 특징을 저장했습니다.');state.view==='adminListings'?renderAdminListings():renderMyListings()};$('#modal').showModal()}

const crm36BaseRenderCustomers=renderCustomers;
renderCustomers=async function(){await crm36BaseRenderCustomers();$$('#customerTable tbody tr').forEach((tr,i)=>{const c=(state.filteredCustomers||state.customers)[i];if(!c)return;const cell=tr.lastElementChild;const box=cell?.querySelector('.row-actions');if(box)box.insertAdjacentHTML('beforeend',`<button class="ghost" onclick="crm36OpenCustomerExclusions('${c.id}')">추천 제외조건</button>`)});};

const crm36BaseListingTable=renderListingTable;
renderListingTable=function(rows,target,mine,adminMode=false){crm36BaseListingTable(rows,target,mine,adminMode);const trs=$$('#'+target+' tbody tr');trs.forEach((tr,i)=>{const l=rows[i];if(!l)return;const title=tr.querySelector('.listing-title-cell');if(title){const tags=crm36Array(l.feature_tags);if(tags.length)title.insertAdjacentHTML('beforeend',`<div class="crm36-feature-tags">${tags.map(x=>`<span>${escapeHtml(x)}</span>`).join('')}</div>`)}const action=tr.lastElementChild?.querySelector('.row-actions');if(action&&(mine||adminMode)){action.insertAdjacentHTML('beforeend',`<button class="success" onclick="crm36ReverseMatch('${l.id}')">고객 찾기</button>`)}})};

async function crm36ConfirmListing(listingId){const l=state.listings.find(x=>x.id===listingId);$('#modalTitle').textContent=`${l.title} · 매물 확인 전화`;$('#modalBody').innerHTML=`<div class="form-grid"><label>확인 결과<select id="crm36ConfirmResult"><option>거래 가능</option><option>가격 변경</option><option>협의 중</option><option>거래 완료</option><option>연락 안 됨</option><option>재확인 필요</option></select></label><label>다음 확인일<input id="crm36NextConfirm" type="date" value="${dateInDays(14)}"></label><label>확인한 가격(만원)<input id="crm36ConfirmPrice" type="number" value="${l.price??''}"></label><label>확인한 월세(만원)<input id="crm36ConfirmRent" type="number" value="${l.monthly_rent??''}"></label><label class="span-2">통화 내용<textarea id="crm36ConfirmNote" rows="6" placeholder="임대인/매도인 통화 내용, 입주 가능일, 가격 협의 여부 등을 기록하세요."></textarea></label></div>`;$('#modalSubmit').style.display='';$('#modalSubmit').onclick=async e=>{e.preventDefault();const result=$('#crm36ConfirmResult').value,price=Number($('#crm36ConfirmPrice').value||0)||null,rent=Number($('#crm36ConfirmRent').value||0)||null,note=$('#crm36ConfirmNote').value;const {error}=await state.client.from('listing_confirmation_logs').insert({listing_id:listingId,confirmed_by:state.profile.id,result,note,confirmed_price:price,confirmed_monthly_rent:rent,next_confirm_at:$('#crm36NextConfirm').value||null});if(error)return toast(error.message);const update={last_confirmed_at:today(),next_confirm_at:$('#crm36NextConfirm').value||null};if(price!==null)update.price=price;if(l.transaction_type==='월세'&&rent!==null)update.monthly_rent=rent;if(result==='거래 완료')update.status='complete';else if(result==='협의 중')update.status='hold';else if(result==='거래 가능')update.status='available';await state.client.from('listings').update(update).eq('id',listingId);await state.client.from('interaction_history').insert({created_by:state.profile.id,follow_up_date:today(),contact_method:'매물확인',content:`확인 결과: ${result}\n${note||''}`,listing_id:listingId,next_follow_up_at:$('#crm36NextConfirm').value||null});$('#modal').close();toast('매물 확인 전화 기록을 저장했습니다.');renderMyListings()};$('#modal').showModal()}
async function crm36PriceHistory(listingId){const l=state.listings.find(x=>x.id===listingId);const {data,error}=await state.client.from('listing_price_history').select('*, changer:profiles!listing_price_history_changed_by_fkey(full_name)').eq('listing_id',listingId).order('created_at',{ascending:false});if(error)return toast(error.message);$('#modalTitle').textContent=`${l.title} · 가격 변경 이력`;$('#modalBody').innerHTML=(data||[]).length?`<div class="history-list">${data.map(x=>`<article class="history-item"><div class="history-head"><strong>${new Date(x.created_at).toLocaleString('ko-KR')}</strong><span class="muted">${escapeHtml(x.changer?.full_name||'')}</span></div><p>${escapeHtml(x.transaction_type||l.transaction_type)} · ${fmtMoney(x.old_price)}${x.old_monthly_rent?` / 월 ${fmtMoney(x.old_monthly_rent)}`:''} → <strong>${fmtMoney(x.new_price)}${x.new_monthly_rent?` / 월 ${fmtMoney(x.new_monthly_rent)}`:''}</strong></p></article>`).join('')}</div>`:'<div class="empty">가격 변경 이력이 없습니다.</div>';$('#modalSubmit').style.display='none';const reset=()=>{$('#modalSubmit').style.display='';$('#modal').removeEventListener('close',reset)};$('#modal').addEventListener('close',reset);$('#modal').showModal()}
async function crm36ReverseMatch(listingId){await loadCustomers();const l=state.listings.find(x=>x.id===listingId);const rows=state.customers.filter(x=>['매수','임차'].includes(x.customer_type)).map(c=>({c,m:evaluateListingMatch(c,l)})).filter(x=>x.m.matched).sort((a,b)=>(a.m.matchKind==='direct'?-1:1)-(b.m.matchKind==='direct'?-1:1));$('#modalTitle').textContent=`${l.title} · 맞는 고객 찾기`;$('#modalBody').innerHTML=rows.length?`<div class="crm36-reverse-list">${rows.map(({c,m})=>`<article class="crm36-reverse-item"><div><strong>${escapeHtml(c.name)}</strong> ${gradeBadge(c.customer_grade)}<div class="muted">${escapeHtml(c.deal_type||c.customer_type)} · 희망 ${fmtMoney(c.budget_max)} · 방 ${customerRoomText(c)}</div><div class="match-reason">${m.reasons.map(r=>`<div>• ${escapeHtml(r)}</div>`).join('')}</div></div><div class="row-actions"><button class="success" onclick="crm36SaveRecommendation('${c.id}','${l.id}')">FU에 추천 저장</button><button class="ghost" onclick="crm36QuickVisit('${c.id}','${l.id}')">방문 일정</button></div></article>`).join('')}</div>`:'<div class="empty">현재 조건에 맞는 고객이 없습니다.</div>';$('#modalSubmit').style.display='none';const reset=()=>{$('#modalSubmit').style.display='';$('#modal').removeEventListener('close',reset)};$('#modal').addEventListener('close',reset);$('#modal').showModal()}

const crm36BaseDashboard=renderDashboard;
renderDashboard=async function(){await crm36BaseDashboard();const recent=state.listings.filter(x=>x.is_public&&x.status==='available'&&x.created_at&&Date.now()-new Date(x.created_at).getTime()<=7*86400000);let matchCount=0;for(const l of recent){if(state.customers.some(c=>['매수','임차'].includes(c.customer_type)&&evaluateListingMatch(c,l).matched))matchCount++}const panel=document.createElement('div');panel.className='panel crm36-new-alert';panel.innerHTML=`<div class="panel-head"><div><h3>신규 추천 가능 매물</h3><div class="muted">최근 7일 등록된 공개 매물 중 내 고객 조건에 맞는 매물</div></div><strong class="crm36-alert-count">${matchCount}건</strong></div>${recent.slice(0,8).map(l=>`<div class="list-item"><div><strong>${escapeHtml(l.title)}</strong><div class="muted">${l.transaction_type} ${listingPriceText(l)} · 방 ${listingRoomText(l)}</div></div><button class="ghost" onclick="crm36ReverseMatch('${l.id}')">맞는 고객</button></div>`).join('')||'<div class="empty">최근 7일 신규 매물이 없습니다.</div>'}`;$('#content').appendChild(panel)};

Object.assign(window,{crm36SaveRecommendation,crm36SetReaction,crm36DeleteRecommendation,crm36QuickVisit,crm36KakaoMessage,crm36OpenCustomerExclusions,crm36OpenListingFeatures,crm36ConfirmListing,crm36PriceHistory,crm36ReverseMatch});
console.info('CRM v3.6 영업 FU·역매칭·알림 로드 완료');

/* v3.6 customer filter action persistence fix */
const crm36BaseFilterCustomers=filterCustomers;
filterCustomers=function(){
  crm36BaseFilterCustomers();
  const q=($('#customerSearch')?.value||'').toLowerCase(),t=$('#customerType')?.value||'',s=$('#customerStatus')?.value||'',d=$('#customerDealType')?.value||'',g=$('#customerGrade')?.value||'';
  const rows=state.customers.filter(x=>(!q||`${x.name} ${x.phone}`.toLowerCase().includes(q))&&(!t||x.customer_type===t)&&(!s||x.status===s)&&(!d||x.deal_type===d)&&(!g||x.customer_grade===g));
  $$('#customerTable tbody tr').forEach((tr,i)=>{const c=rows[i];if(!c)return;const box=tr.lastElementChild?.querySelector('.row-actions');if(box&&!box.querySelector('[data-crm36-exclusion]'))box.insertAdjacentHTML('beforeend',`<button data-crm36-exclusion class="ghost" onclick="crm36OpenCustomerExclusions('${c.id}')">추천 제외조건</button>`)});
};
Object.assign(window,{openHistoryModal,showCustomerMatches,filterCustomers});


/* ================= CRM v3.6.1 간소화: 매물 FU 통합 + 등록폼 특징 ================= */
const crm361BaseOpenFollowUpModal=openFollowUpModal;
function crm361SetFuTab(tab){
  $$('.crm361-fu-tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
  $$('.crm361-fu-panel').forEach(p=>p.classList.toggle('hidden',p.dataset.panel!==tab));
  const submit=$('#modalSubmit');
  submit.style.display=tab==='history'?'none':'';
  if(tab==='history')crm361LoadPriceHistory($('#crm361ListingId').value);
}
async function crm361LoadPriceHistory(listingId){
  const box=$('#crm361PriceHistory');if(!box)return;
  box.innerHTML='<div class="empty">가격 이력을 불러오는 중입니다.</div>';
  const l=state.listings.find(x=>x.id===listingId);
  const {data,error}=await state.client.from('listing_price_history').select('*, changer:profiles!listing_price_history_changed_by_fkey(full_name)').eq('listing_id',listingId).order('created_at',{ascending:false});
  if(error){box.innerHTML=`<div class="empty">${escapeHtml(error.message)}</div>`;return}
  box.innerHTML=(data||[]).length?`<div class="history-list">${data.map(x=>`<article class="history-item"><div class="history-head"><strong>${new Date(x.created_at).toLocaleString('ko-KR')}</strong><span class="muted">${escapeHtml(x.changer?.full_name||'')}</span></div><p>${escapeHtml(x.transaction_type||l?.transaction_type||'')} · ${fmtMoney(x.old_price)}${x.old_monthly_rent?` / 월 ${fmtMoney(x.old_monthly_rent)}`:''} → <strong>${fmtMoney(x.new_price)}${x.new_monthly_rent?` / 월 ${fmtMoney(x.new_monthly_rent)}`:''}</strong></p></article>`).join('')}</div>`:'<div class="empty">가격 변경 이력이 없습니다.</div>';
}
async function crm361OpenListingFu(id){
  const item=state.listings.find(x=>x.id===id);if(!item)return toast('매물을 찾지 못했습니다.');
  $('#modalTitle').textContent=`${item.title} · FU 관리`;
  $('#modalBody').innerHTML=`<input id="crm361ListingId" type="hidden" value="${id}"><div class="crm361-fu-tabs"><button type="button" class="crm361-fu-tab active" data-tab="record" onclick="crm361SetFuTab('record')">FU 기록</button><button type="button" class="crm361-fu-tab" data-tab="confirm" onclick="crm361SetFuTab('confirm')">확인 전화</button><button type="button" class="crm361-fu-tab" data-tab="history" onclick="crm361SetFuTab('history')">가격 이력</button></div>
  <section class="crm361-fu-panel" data-panel="record"><div class="form-grid"><label>기록 일자<input id="crm361FuDate" type="date" value="${today()}" required></label><label>상담 종류<select id="crm361FuMethod"><option>전화</option><option>대면투어</option><option>촬영</option><option>문자/톡 발송</option><option>문자/톡 수신</option><option>부재중</option><option>가계약</option><option>본계약</option><option>중도금</option><option>잔금</option><option>기타</option></select></label><label class="span-2">상담·진행 내용<textarea id="crm361FuContent" rows="7" placeholder="통화 내용, 조건 변경, 다음 조치 등을 구체적으로 기록하세요."></textarea></label><label>예정 FU<input id="crm361FuNext" type="date" value="${item.next_follow_up_at?item.next_follow_up_at.slice(0,10):''}"></label></div></section>
  <section class="crm361-fu-panel hidden" data-panel="confirm"><div class="notice">임대인·매도인에게 확인한 내용을 기록합니다. 가격을 변경하면 가격 이력에 자동 저장됩니다.</div><div class="form-grid" style="margin-top:14px"><label>확인 결과<select id="crm361ConfirmResult"><option>거래 가능</option><option>가격 변경</option><option>협의 중</option><option>거래 완료</option><option>연락 안 됨</option><option>재확인 필요</option></select></label><label>다음 확인일<input id="crm361NextConfirm" type="date" value="${item.next_confirm_at?item.next_confirm_at.slice(0,10):dateInDays(14)}"></label><label>확인한 가격(만원)<input id="crm361ConfirmPrice" type="number" value="${item.price??''}"></label><label>확인한 월세(만원)<input id="crm361ConfirmRent" type="number" value="${item.monthly_rent??''}"></label><label class="span-2">통화 내용<textarea id="crm361ConfirmNote" rows="7" placeholder="거래 가능 여부, 가격 협의, 입주 가능일, 추가 확인사항 등을 기록하세요."></textarea></label></div></section>
  <section class="crm361-fu-panel hidden" data-panel="history"><div id="crm361PriceHistory"></div></section>`;
  $('#modalSubmit').style.display='';
  $('#modalSubmit').onclick=async e=>{e.preventDefault();const active=$('.crm361-fu-tab.active')?.dataset.tab||'record';
    if(active==='record'){
      const content=$('#crm361FuContent').value.trim();if(!content)return toast('FU 내용을 입력하세요.');
      const history={created_by:state.profile.id,follow_up_date:$('#crm361FuDate').value,contact_method:$('#crm361FuMethod').value,content,next_follow_up_at:$('#crm361FuNext').value||null,customer_id:null,listing_id:id};
      const {error}=await state.client.from('interaction_history').insert(history);if(error)return toast(error.message);
      const {error:updateError}=await state.client.from('listings').update({last_follow_up_at:history.follow_up_date,next_follow_up_at:history.next_follow_up_at}).eq('id',id);if(updateError)return toast(updateError.message);
      $('#modal').close();toast('FU 내용을 저장했습니다.');return state.view==='adminListings'?renderAdminListings():renderMyListings();
    }
    if(active==='confirm'){
      const result=$('#crm361ConfirmResult').value,price=$('#crm361ConfirmPrice').value===''?null:Number($('#crm361ConfirmPrice').value),rent=$('#crm361ConfirmRent').value===''?null:Number($('#crm361ConfirmRent').value),note=$('#crm361ConfirmNote').value.trim(),next=$('#crm361NextConfirm').value||null;
      const {error}=await state.client.from('listing_confirmation_logs').insert({listing_id:id,confirmed_by:state.profile.id,result,note:note||null,confirmed_price:price,confirmed_monthly_rent:rent,next_confirm_at:next});if(error)return toast(error.message);
      const update={last_confirmed_at:today(),next_confirm_at:next};if(price!==null)update.price=price;if(item.transaction_type==='월세'&&rent!==null)update.monthly_rent=rent;if(result==='거래 완료')update.status='complete';else if(result==='협의 중')update.status='hold';else if(result==='거래 가능')update.status='available';
      const {error:uErr}=await state.client.from('listings').update(update).eq('id',id);if(uErr)return toast(uErr.message);
      await state.client.from('interaction_history').insert({created_by:state.profile.id,follow_up_date:today(),contact_method:'매물확인',content:`확인 결과: ${result}${note?`\n${note}`:''}`,listing_id:id,next_follow_up_at:next});
      $('#modal').close();toast('확인 전화와 FU 기록을 저장했습니다.');return state.view==='adminListings'?renderAdminListings():renderMyListings();
    }
  };
  $('#modal').showModal();
}
openFollowUpModal=function(entityType,id){return entityType==='listing'?crm361OpenListingFu(id):crm361BaseOpenFollowUpModal(entityType,id)};
Object.assign(window,{openFollowUpModal,crm361SetFuTab});
console.info('CRM v3.6.1 간소화 FU 통합 로드 완료');


/* ================= CRM v3.6.2 사이드바 프로필 관리 ================= */
state.sidebarBranding=null;

async function crm362LoadSidebarBranding(){
  let data=null;
  const {data:row,error}=await state.client.from('app_settings').select('*').eq('setting_key','sidebar_profile').maybeSingle();
  if(!error&&row)data=row;
  state.sidebarBranding=data||{title:'공동매물 CRM',subtitle:state.profile?.office_name||'더퍼스트',image_path:null};
  crm362ApplySidebarBranding();
}

function crm362ApplySidebarBranding(){
  const b=state.sidebarBranding||{};
  const title=b.title||'공동매물 CRM';
  const subtitle=b.subtitle||state.profile?.office_name||'더퍼스트';
  $('#sidebarProfileTitle').textContent=title;
  $('#sidebarProfileSubtitle').textContent=subtitle;
  const img=$('#sidebarProfileImage'),fallback=$('#sidebarProfileFallback');
  if(b.image_path){
    const {data}=state.client.storage.from('crm-branding').getPublicUrl(b.image_path);
    img.src=data?.publicUrl?`${data.publicUrl}?v=${encodeURIComponent(b.updated_at||Date.now())}`:'';
    img.classList.toggle('hidden',!img.src);
    fallback.classList.toggle('hidden',!!img.src);
  }else{
    img.removeAttribute('src');img.classList.add('hidden');fallback.classList.remove('hidden');
  }
}

async function crm362OpenSidebarBranding(){
  if(state.profile?.role!=='admin')return;
  const b=state.sidebarBranding||{};
  let previewUrl='';
  if(b.image_path){const {data}=state.client.storage.from('crm-branding').getPublicUrl(b.image_path);previewUrl=data?.publicUrl||''}
  $('#modalTitle').textContent='사이드바 프로필 수정';
  $('#modalBody').innerHTML=`
    <div class="form-grid">
      <label class="span-2">위쪽 제목<input id="brandingTitle" maxlength="30" value="${escapeHtml(b.title||'공동매물 CRM')}" placeholder="예: 더퍼스트 공동매물 CRM"></label>
      <label class="span-2">아래 문구<input id="brandingSubtitle" maxlength="40" value="${escapeHtml(b.subtitle||state.profile.office_name||'')}" placeholder="예: 더퍼스트 부동산"></label>
      <label class="span-2">프로필 사진<input id="brandingImageFile" type="file" accept="image/png,image/jpeg,image/webp"><span class="field-help">정사각형 이미지 권장 · 최대 5MB · PNG/JPG/WEBP</span></label>
      <div class="span-2 branding-preview">
        ${previewUrl?`<img id="brandingCurrentPreview" src="${previewUrl}" alt="현재 프로필 이미지">`:`<div id="brandingCurrentPreview" class="branding-preview-fallback">중개</div>`}
        <div><strong>현재 표시 미리보기</strong><div class="muted">제목과 문구는 저장 후 모든 직원 화면에 동일하게 적용됩니다.</div>${b.image_path?'<label class="branding-remove-row"><input id="brandingRemoveImage" type="checkbox"> 현재 사진 삭제</label>':''}</div>
      </div>
    </div>`;
  const fileInput=$('#brandingImageFile');
  fileInput.onchange=()=>{const f=fileInput.files?.[0];if(!f)return;const url=URL.createObjectURL(f);const old=$('#brandingCurrentPreview');const img=document.createElement('img');img.id='brandingCurrentPreview';img.src=url;img.alt='새 프로필 이미지 미리보기';old.replaceWith(img)};
  $('#modalSubmit').style.display='';
  $('#modalSubmit').onclick=crm362SaveSidebarBranding;
  $('#modal').showModal();
}

async function crm362SaveSidebarBranding(e){
  e.preventDefault();
  if(state.profile?.role!=='admin')return toast('관리자만 수정할 수 있습니다.');
  const title=$('#brandingTitle').value.trim()||'공동매물 CRM';
  const subtitle=$('#brandingSubtitle').value.trim();
  const file=$('#brandingImageFile').files?.[0];
  const remove=$('#brandingRemoveImage')?.checked;
  if(file&&file.size>5*1024*1024)return toast('사진은 5MB 이하만 등록할 수 있습니다.');
  let imagePath=state.sidebarBranding?.image_path||null;
  if(remove&&imagePath){await state.client.storage.from('crm-branding').remove([imagePath]);imagePath=null}
  if(file){
    if(!file.type.startsWith('image/'))return toast('이미지 파일만 등록할 수 있습니다.');
    if(imagePath)await state.client.storage.from('crm-branding').remove([imagePath]);
    const ext=(file.name.split('.').pop()||'jpg').replace(/[^a-z0-9]/gi,'').toLowerCase()||'jpg';
    imagePath=`sidebar/profile-${Date.now()}.${ext}`;
    const {error:upError}=await state.client.storage.from('crm-branding').upload(imagePath,file,{upsert:true,contentType:file.type,cacheControl:'3600'});
    if(upError)return toast(`사진 업로드 실패: ${upError.message}`);
  }
  const payload={setting_key:'sidebar_profile',title,subtitle,image_path:imagePath,updated_by:state.profile.id,updated_at:new Date().toISOString()};
  const {data,error}=await state.client.from('app_settings').upsert(payload,{onConflict:'setting_key'}).select().single();
  if(error)return toast(error.message);
  state.sidebarBranding=data;
  crm362ApplySidebarBranding();
  $('#modal').close();
  toast('사이드바 프로필을 변경했습니다.');
}

const crm362OriginalLoadProfile=loadProfile;
loadProfile=async function(){
  await crm362OriginalLoadProfile();
  if(state.profile?.status==='approved')await crm362LoadSidebarBranding();
};

document.addEventListener('DOMContentLoaded',()=>{
  const btn=$('#editSidebarProfileBtn');
  if(btn)btn.addEventListener('click',crm362OpenSidebarBranding);
});

console.info('CRM v3.6.2 사이드바 프로필 관리 로드 완료');

/* ================= CRM v3.7 업무 통합·빠른등록·공지 ================= */
state.announcements=[];
const CRM37_CUSTOMER_STAGES=['신규 문의','조건 확인','매물 추천','방문 예정','방문 완료','협의 중','계약 예정','계약 완료','보류','종료'];

function crm37DaysSince(value){
  if(!value)return 999;
  const d=new Date(value); if(Number.isNaN(d.getTime()))return 999;
  return Math.max(0,Math.floor((Date.now()-d.getTime())/86400000));
}
function crm37LastContact(customer){return customer.last_follow_up_at||customer.updated_at||customer.created_at}
function crm37DormantInfo(customer){
  const days=crm37DaysSince(crm37LastContact(customer));
  if(days>=30)return {days,label:`${days}일 미접촉`,color:'red'};
  if(days>=14)return {days,label:`${days}일 미접촉`,color:'yellow'};
  if(days>=7)return {days,label:`${days}일 미접촉`,color:'gray'};
  return {days,label:'',color:'gray'};
}
async function crm37LoadAnnouncements(){
  const {data,error}=await state.client.from('announcements').select('*, author:profiles!announcements_created_by_fkey(full_name)').eq('is_active',true).order('is_pinned',{ascending:false}).order('created_at',{ascending:false}).limit(20);
  if(error){console.warn(error.message);state.announcements=[];return []}
  state.announcements=data||[];return state.announcements;
}
function crm37AnnouncementCard(a){
  return `<article class="announcement-card ${a.is_pinned?'pinned':''}"><div class="announcement-title">${a.is_pinned?'📌 ':''}${escapeHtml(a.title)}</div><div class="announcement-body">${escapeHtml(a.content||'').replace(/\n/g,'<br>')}</div><div class="muted">${escapeHtml(a.author?.full_name||'관리자')} · ${fmtDate(a.created_at)}</div></article>`;
}
function crm37AnnouncementCards(){
  if(!state.announcements.length) return '<div class="empty">등록된 공지사항이 없습니다.</div>';
  return `<div class="announcement-list crm3832-announcement-preview">${state.announcements.map(crm37AnnouncementCard).join('')}</div>`;
}
function crm3832OpenAnnouncementList(){
  $('#modalTitle').textContent='공지사항 전체보기';
  $('#modalBody').innerHTML=state.announcements.length?`<div class="announcement-list crm3832-announcement-all">${state.announcements.map(crm37AnnouncementCard).join('')}</div>`:'<div class="empty">등록된 공지사항이 없습니다.</div>';
  $('#modalSubmit').style.display='none';
  $('#modal').showModal();
}

async function crm37OpenQuickCustomer(){
  $('#modalTitle').textContent='고객 빠른 등록';
  $('#modalBody').innerHTML=`<div class="notice">필수 정보만 먼저 저장하고, 고객 목록의 수정 버튼에서 상세 내용을 보완할 수 있습니다.</div><div class="form-grid" style="margin-top:14px"><label>고객명<input id="qCustomerName" required></label><label>연락처<input id="qCustomerPhone" placeholder="010-0000-0000" required></label><label>고객 구분<select id="qCustomerKind"><option>매수</option><option>임차</option><option>매도</option><option>임대</option></select></label><label>거래유형<select id="qCustomerDeal"><option>매매</option><option>전세</option><option>월세</option></select></label><label>희망금액/보증금(만원)<input id="qCustomerBudget" type="number"></label><label>희망 월세(만원)<input id="qCustomerRent" type="number"></label><label>희망 방 개수<input id="qCustomerRooms" type="number" min="0" step="0.5"></label><label>다음 FU<input id="qCustomerFu" type="date"></label><label class="span-2">메모<textarea id="qCustomerMemo" rows="4"></textarea></label></div>`;
  $('#modalSubmit').style.display='';$('#modalSubmit').onclick=async e=>{e.preventDefault();const kind=$('#qCustomerKind').value,deal=$('#qCustomerDeal').value;const rooms=Number($('#qCustomerRooms').value||0);const payload={owner_id:state.profile.id,name:$('#qCustomerName').value.trim(),phone:$('#qCustomerPhone').value.trim(),customer_type:kind,status:'신규 문의',deal_type:['매수','임차'].includes(kind)?deal:null,budget_max:$('#qCustomerBudget').value?Number($('#qCustomerBudget').value):null,desired_monthly_rent:deal==='월세'&&$('#qCustomerRent').value?Number($('#qCustomerRent').value):null,desired_rooms:rooms===1.5?1:(rooms||null),desired_one_point_five_room:rooms===1.5,next_follow_up_at:$('#qCustomerFu').value||null,notes:$('#qCustomerMemo').value||null,customer_grade:'C'};if(!payload.name||!payload.phone)return toast('고객명과 연락처를 입력하세요.');const {error}=await state.client.from('customers').insert(payload);if(error)return toast(error.message);$('#modal').close();toast('고객을 빠르게 등록했습니다.');await loadCustomers();if(state.view==='customers')renderCustomers();};$('#modal').showModal();
}
async function crm37OpenQuickListing(){
  $('#modalTitle').textContent='매물 빠른 등록';
  $('#modalBody').innerHTML=`<div class="notice">핵심 정보만 저장합니다. 이후 매물 수정에서 사진·특징·상세 내용을 보완하세요.</div><div class="form-grid" style="margin-top:14px"><label>매물명<input id="qListingTitle" required></label><label>거래유형<select id="qListingTx"><option>매매</option><option>전세</option><option>월세</option></select></label><label>매물유형<select id="qListingType"><option>아파트</option><option>오피스텔</option><option>빌라</option><option>원룸</option><option>상가</option><option>사무실</option><option>기타</option></select></label><label>매매가/전세금/보증금(만원)<input id="qListingPrice" type="number"></label><label>월세(만원)<input id="qListingRent" type="number"></label><label>방 개수<input id="qListingRooms" type="number" min="0" step="0.5"></label><label>지역·주소<input id="qListingAddress"></label><label>연락처<input id="qListingPhone"></label><label class="span-2">메모<textarea id="qListingMemo" rows="4"></textarea></label></div>`;
  $('#modalSubmit').style.display='';$('#modalSubmit').onclick=async e=>{e.preventDefault();const tx=$('#qListingTx').value,rooms=Number($('#qListingRooms').value||0),address=$('#qListingAddress').value.trim();const payload={owner_id:state.profile.id,title:$('#qListingTitle').value.trim(),transaction_type:tx,property_type:$('#qListingType').value,price:$('#qListingPrice').value?Number($('#qListingPrice').value):null,monthly_rent:tx==='월세'&&$('#qListingRent').value?Number($('#qListingRent').value):null,room_count:rooms===1.5?1:(rooms||null),is_one_point_five_room:rooms===1.5,district:address,address,contact_phone:$('#qListingPhone').value.trim()||null,description:$('#qListingMemo').value||null,status:'available',is_public:true};if(!payload.title)return toast('매물명을 입력하세요.');const {error}=await state.client.from('listings').insert(payload);if(error)return toast(error.message);$('#modal').close();toast('매물을 빠르게 등록했습니다.');await loadListings();if(state.view==='myListings')renderMyListings();};$('#modal').showModal();
}
function crm37AddQuickActions(){
  // 대시보드에는 본문 안의 빠른 등록 버튼만 표시하고, 상단 번개 버튼은 숨깁니다.
  if(state.view==='dashboard') return;
  const top=$('#topActions');if(!top||top.querySelector('.crm37-quick-actions'))return;
  top.insertAdjacentHTML('afterbegin',`<span class="crm37-quick-actions"><button class="ghost" onclick="crm37OpenQuickCustomer()">⚡ 고객 빠른 등록</button><button class="ghost" onclick="crm37OpenQuickListing()">⚡ 매물 빠른 등록</button></span>`);
}

const crm37BaseRenderView=renderView;
renderView=async function(view){await crm37BaseRenderView(view);crm37AddQuickActions();};

const crm37BaseRenderDashboard=renderDashboard;
renderDashboard=async function(){
  await Promise.all([loadCustomers(),loadListings(),crm37LoadAnnouncements()]);
  await crm37BaseRenderDashboard();
  const todayStr=today(), seven=dateInDays(7);
  const dueCustomers=state.customers.filter(x=>x.next_follow_up_at&&x.next_follow_up_at<=todayStr);
  const dueListings=state.listings.filter(x=>x.owner_id===state.profile.id&&x.next_follow_up_at&&x.next_follow_up_at<=todayStr);
  const dormant=state.customers.filter(x=>crm37DormantInfo(x).days>=7).sort((a,b)=>crm37DormantInfo(b).days-crm37DormantInfo(a).days);
  const {data:visits}=await state.client.from('customer_listing_recommendations').select('*, customer:customers(name), listing:listings(title)').not('visit_at','is',null).gte('visit_at',new Date(todayStr+'T00:00:00').toISOString()).lte('visit_at',new Date(seven+'T23:59:59').toISOString()).order('visit_at');
  const contracts=[];[...state.customers,...state.listings.filter(x=>x.owner_id===state.profile.id)].forEach(x=>[['가계약',x.provisional_contract_date],['본계약',x.contract_date],['중도금',x.interim_payment_date],['잔금',x.final_payment_date]].forEach(([label,d])=>{if(d&&d>=todayStr&&d<=seven)contracts.push({label,date:d,name:x.name||x.title})}));
  const newListings=state.listings.filter(x=>x.is_public&&x.status==='available'&&crm37DaysSince(x.created_at)<=7);
  const matchingPairs=[];newListings.forEach(l=>state.customers.forEach(c=>{const m=evaluateListingMatch(c,l);if(m.matched)matchingPairs.push({l,c,m})}));
  $('#content').innerHTML=`<div class="today-command"><div class="panel-head"><div><h3>오늘 할 일 통합 화면</h3><div class="muted">오늘 처리해야 할 업무를 한곳에서 확인합니다.</div></div><div class="row-actions"><button class="primary" onclick="crm37OpenQuickCustomer()">고객 빠른 등록</button><button class="success" onclick="crm37OpenQuickListing()">매물 빠른 등록</button></div></div><div class="grid stats"><div class="card stat"><div class="label">오늘·지연 FU</div><div class="value">${dueCustomers.length+dueListings.length}</div></div><div class="card stat"><div class="label">7일 내 방문</div><div class="value">${(visits||[]).length}</div></div><div class="card stat"><div class="label">7일 내 계약 일정</div><div class="value">${contracts.length}</div></div><div class="card stat alert-card"><div class="label">장기 미접촉 고객</div><div class="value">${dormant.length}</div></div><div class="card stat"><div class="label">신규 매칭 후보</div><div class="value">${matchingPairs.length}</div></div></div></div>
  <div class="dashboard-three"><section class="panel"><div class="panel-head"><h3>오늘 처리할 FU</h3></div>${[...dueCustomers.map(x=>({name:x.name,type:'고객',date:x.next_follow_up_at,id:x.id})),...dueListings.map(x=>({name:x.title,type:'매물',date:x.next_follow_up_at,id:x.id}))].slice(0,12).map(x=>`<div class="list-item"><div><strong>${escapeHtml(x.name)}</strong><div class="muted">${x.type}</div></div><div class="row-actions">${dueBadge(x.date)}<button class="success" onclick="openFollowUpModal('${x.type==='고객'?'customer':'listing'}','${x.id}')">FU</button></div></div>`).join('')||'<div class="empty">오늘 처리할 FU가 없습니다.</div>'}</section>
  <section class="panel"><div class="panel-head"><h3>방문·계약 일정</h3></div>${[...(visits||[]).map(v=>({date:v.visit_at?.slice(0,10),label:'방문',name:`${v.customer?.name||'고객'} · ${v.listing?.title||'매물'}`})),...contracts].sort((a,b)=>(a.date||'').localeCompare(b.date||'')).slice(0,12).map(x=>`<div class="list-item"><div><strong>${escapeHtml(x.name)}</strong><div class="muted">${escapeHtml(x.label)}</div></div>${dueBadge(x.date)}</div>`).join('')||'<div class="empty">7일 내 일정이 없습니다.</div>'}</section>
  <section class="panel"><div class="panel-head"><h3>장기 미접촉 고객</h3><button class="ghost" onclick="renderView('customers')">고객목록</button></div>${dormant.slice(0,12).map(c=>`<div class="list-item"><div><strong>${escapeHtml(c.name)}</strong><div class="muted">${escapeHtml(c.phone||'')} · ${escapeHtml(c.status||'')}</div></div><div class="row-actions">${badge(crm37DormantInfo(c).label,crm37DormantInfo(c).color)}<button class="success" onclick="openFollowUpModal('customer','${c.id}')">연락 기록</button></div></div>`).join('')||'<div class="empty">7일 이상 미접촉 고객이 없습니다.</div>'}</section></div>
  <div class="split" style="margin-top:16px"><section class="panel"><div class="panel-head"><h3>신규 매물 알림·재매칭</h3><button class="ghost" onclick="renderView('smartMatch')">자동매칭</button></div>${matchingPairs.slice(0,12).map(p=>`<div class="list-item"><div><strong>${escapeHtml(p.l.title)}</strong><div class="muted">${escapeHtml(p.c.name)} 고객 · ${escapeHtml(p.m.category)}</div></div><button class="success" onclick="crm36SaveRecommendation('${p.c.id}','${p.l.id}')">FU 저장</button></div>`).join('')||'<div class="empty">최근 7일 신규 매칭 후보가 없습니다.</div>'}</section><section class="panel crm3832-announcement-panel"><div class="panel-head"><h3>공지사항</h3><div class="crm3832-announcement-actions"><button class="ghost" onclick="crm3832OpenAnnouncementList()">더보기</button>${state.profile?.role==='admin'?'<button class="primary" onclick="crm37ManageAnnouncements()">공지 관리</button>':''}</div></div>${crm37AnnouncementCards()}</section></div>`;
  crm37AddQuickActions();
};

const crm37BaseOpenCustomerModal=openCustomerModal;
openCustomerModal=function(id){
  const before=id?structuredClone(state.customers.find(x=>x.id===id)||{}):null;
  crm37BaseOpenCustomerModal(id);
  const status=$('#modalBody [name=status]');if(status){status.innerHTML=CRM37_CUSTOMER_STAGES.map(x=>`<option>${x}</option>`).join('');const old=before?.status||'신규 문의';status.value=CRM37_CUSTOMER_STAGES.includes(old)?old:({'신규':'신규 문의','상담중':'조건 확인','매물제안':'매물 추천','계약협의':'협의 중','계약완료':'계약 완료'}[old]||'신규 문의')}
  const original=$('#modalSubmit').onclick;
  $('#modalSubmit').onclick=async e=>{
    if(!id)return original(e);
    e.preventDefault();const form=$('#modalForm');const fd=new FormData(form);const changed=[];const fields=[['deal_type','거래유형'],['budget_max','희망금액'],['desired_monthly_rent','희망월세'],['desired_rooms','희망 방 개수'],['preferred_area','희망지역'],['status','고객단계']];fields.forEach(([key,label])=>{const nv=fd.get(key)||'';const ov=before?.[key]??'';if(String(nv)!==String(ov))changed.push({field_name:key,field_label:label,old_value:String(ov),new_value:String(nv)})});
    await original({preventDefault(){}});
    if(changed.length){await state.client.from('customer_condition_history').insert(changed.map(c=>({...c,customer_id:id,changed_by:state.profile.id})));await loadCustomers();await loadListings();const customer=state.customers.find(x=>x.id===id);const count=state.listings.filter(l=>l.is_public&&l.status==='available'&&evaluateListingMatch(customer,l).matched).length;toast(`고객 조건 변경 완료 · 새 조건 매칭 매물 ${count}건`);setTimeout(()=>{if(confirm(`조건이 변경되었습니다. 새 조건에 맞는 매물 ${count}건을 확인할까요?`)){renderView('smartMatch').then(()=>{const s=$('#matchCustomer');if(s){s.value=id;showCustomerMatches()}})}},300)}
  };
};

const crm37BaseRenderCustomers=renderCustomers;
renderCustomers=async function(){await crm37BaseRenderCustomers();const filter=$('#customerStatus');if(filter){filter.innerHTML='<option value="">전체 단계</option>'+CRM37_CUSTOMER_STAGES.map(x=>`<option>${x}</option>`).join('')};filterCustomers();crm37AddQuickActions();};
filterCustomers=function(){
  const q=($('#customerSearch')?.value||'').toLowerCase(),t=$('#customerType')?.value||'',s=$('#customerStatus')?.value||'',d=$('#customerDealType')?.value||'',g=$('#customerGrade')?.value||'';
  const rows=state.customers.filter(x=>(!q||`${x.name} ${x.phone}`.toLowerCase().includes(q))&&(!t||x.customer_type===t)&&(!s||x.status===s)&&(!d||x.deal_type===d)&&(!g||x.customer_grade===g));
  $('#customerTable').innerHTML=rows.length?`<div class="table-wrap"><table class="customer-table"><thead><tr><th>고객명</th><th>연락처</th><th>단계</th><th>미접촉</th><th>거래유형</th><th>등급</th><th>희망지역</th><th>방</th><th>희망금액/월세</th><th>예정 FU</th><th>관리</th></tr></thead><tbody>${rows.map(x=>{const dorm=crm37DormantInfo(x);return `<tr><td><strong>${escapeHtml(x.name)}</strong></td><td>${escapeHtml(x.phone||'-')}</td><td>${badge(x.status||'신규 문의','blue')}</td><td>${dorm.label?badge(dorm.label,dorm.color):badge('최근 연락','green')}</td><td>${escapeHtml(x.deal_type||'-')}</td><td>${gradeBadge(x.customer_grade)}</td><td>${escapeHtml(x.preferred_area||'-')}</td><td>${customerRoomText(x)}</td><td>${customerBudgetText(x)}</td><td>${dueBadge(x.next_follow_up_at)}</td><td><div class="row-actions"><button class="success" onclick="openFollowUpModal('customer','${x.id}')">FU</button><button class="ghost" onclick="openHistoryModal('customer','${x.id}')">히스토리</button><button class="ghost" onclick="openContractModal('customer','${x.id}')">진행상황</button><button class="ghost" onclick="openCustomerModal('${x.id}')">수정</button><button class="danger" onclick="deleteCustomer('${x.id}')">삭제</button></div></td></tr>`}).join('')}</tbody></table></div>`:'<div class="empty">조건에 맞는 고객이 없습니다.</div>';
};

async function crm37ManageAnnouncements(){
  if(state.profile?.role!=='admin')return;
  await crm37LoadAnnouncements();$('#modalTitle').textContent='공지사항 관리';$('#modalBody').innerHTML=`<div class="form-grid"><label class="span-2">제목<input id="annTitle" maxlength="100"></label><label class="span-2">내용<textarea id="annContent" rows="6"></textarea></label><label class="inline-check"><input id="annPinned" type="checkbox"> 상단 고정</label></div><div class="panel" style="margin-top:16px"><h4>현재 공지</h4>${state.announcements.map(a=>`<div class="list-item"><div><strong>${escapeHtml(a.title)}</strong><div class="muted">${escapeHtml((a.content||'').slice(0,80))}</div></div><button class="danger" onclick="crm37DeleteAnnouncement('${a.id}')">삭제</button></div>`).join('')||'<div class="empty">공지 없음</div>'}</div>`;$('#modalSubmit').style.display='';$('#modalSubmit').onclick=async e=>{e.preventDefault();const title=$('#annTitle').value.trim(),content=$('#annContent').value.trim();if(!title||!content)return toast('제목과 내용을 입력하세요.');const {error}=await state.client.from('announcements').insert({title,content,is_pinned:$('#annPinned').checked,created_by:state.profile.id,is_active:true});if(error)return toast(error.message);$('#modal').close();toast('공지사항을 등록했습니다.');renderDashboard()};$('#modal').showModal();
}
async function crm37DeleteAnnouncement(id){if(state.profile?.role!=='admin')return toast('관리자만 공지사항을 삭제할 수 있습니다.');if(!confirm('공지사항을 삭제할까요?'))return;const {error}=await state.client.from('announcements').update({is_active:false}).eq('id',id);if(error)return toast(error.message);$('#modal').close();toast('공지사항을 삭제했습니다.');renderDashboard()}

const crm37BaseRenderAdminStats=renderAdminStats;
renderAdminStats=async function(){await crm37BaseRenderAdminStats();await Promise.all([loadCustomers(),loadListings(),loadMembers()]);const now=today();const rows=state.members.filter(m=>m.status==='approved').map(m=>{const cs=state.customers.filter(c=>c.owner_id===m.id),ls=state.listings.filter(l=>l.owner_id===m.id);return {m,customers:cs.length,listings:ls.length,due:cs.filter(c=>c.next_follow_up_at&&c.next_follow_up_at<=now).length,dormant:cs.filter(c=>crm37DormantInfo(c).days>=14).length,contracts:[...cs,...ls].filter(x=>x.contract_date||x.final_payment_date).length}});$('#content').insertAdjacentHTML('afterbegin',`<div class="panel" style="margin-bottom:16px"><div class="panel-head"><div><h3>담당 중개사 업무량</h3><div class="muted">업무 누락과 담당 편중을 확인하는 관리용 화면입니다.</div></div></div><div class="table-wrap"><table><thead><tr><th>중개사</th><th>고객</th><th>매물</th><th>오늘·지연 FU</th><th>14일+ 미접촉</th><th>계약 진행/완료</th></tr></thead><tbody>${rows.map(r=>`<tr><td><strong>${escapeHtml(r.m.full_name||'-')}</strong></td><td>${r.customers}</td><td>${r.listings}</td><td>${r.due?badge(String(r.due),'red'):'0'}</td><td>${r.dormant?badge(String(r.dormant),'yellow'):'0'}</td><td>${r.contracts}</td></tr>`).join('')}</tbody></table></div></div>`);crm37AddQuickActions();};

Object.assign(window,{renderView,renderDashboard,renderCustomers,filterCustomers,openCustomerModal,crm37OpenQuickCustomer,crm37OpenQuickListing,crm37ManageAnnouncements,crm37DeleteAnnouncement,crm3832OpenAnnouncementList});
console.info('CRM v3.7 업무 통합 기능 로드 완료');

/* ===== CRM v3.8 매물 입력·사진·복수거래 개선 ===== */
state.listingDealOptions=[];
state.listingContacts=[];
const crm38BaseLoadListings=loadListings;
loadListings=async function(){
  await crm38BaseLoadListings();
  const ids=(state.listings||[]).map(x=>x.id);
  if(!ids.length){state.listingDealOptions=[];state.listingContacts=[];return;}
  const [{data:opts},{data:contacts}]=await Promise.all([
    state.client.from('listing_deal_options').select('*').in('listing_id',ids).order('sort_order'),
    state.client.from('listing_contacts').select('*').in('listing_id',ids).order('sort_order')
  ]);
  state.listingDealOptions=opts||[];state.listingContacts=contacts||[];
  state.listings.forEach(l=>{l.deal_options=state.listingDealOptions.filter(o=>o.listing_id===l.id);l.additional_contacts=state.listingContacts.filter(c=>c.listing_id===l.id)});
  state.myListings=(state.listings||[]).filter(x=>x.owner_id===state.profile?.id);
};
function crm38DealOptions(l){
  if(l?.deal_options?.length)return l.deal_options;
  if(!l)return[];
  return [{deal_type:l.transaction_type||'매매',price:l.price??null,monthly_rent:l.monthly_rent??null,is_preferred:true,sort_order:0}];
}
function crm38DealTypeText(l){return crm38DealOptions(l).map(o=>o.deal_type+(o.is_preferred?' ★':'')).join(' · ')}
const crm38BaseListingPriceText=listingPriceText;
listingPriceText=function(l){
  const opts=crm38DealOptions(l);if(opts.length<=1)return crm38BaseListingPriceText(l);
  return opts.map(o=>o.deal_type==='월세'?`월세 ${fmtMoney(o.price)} / ${fmtMoney(o.monthly_rent)}`:`${o.deal_type} ${fmtMoney(o.price)}`).join('<br>');
};
const crm38BaseEvaluateListingMatch=evaluateListingMatch;
evaluateListingMatch=function(customer,listing){
  const opts=crm38DealOptions(listing);if(opts.length<=1)return crm38BaseEvaluateListingMatch(customer,listing);
  const results=opts.map(o=>crm38BaseEvaluateListingMatch(customer,{...listing,transaction_type:o.deal_type,price:o.price,monthly_rent:o.monthly_rent}));
  const matched=results.filter(r=>r.matched);if(!matched.length)return results[0]||{matched:false,reasons:['거래조건 불일치']};
  matched.sort((a,b)=>(b.score||0)-(a.score||0));return matched[0];
};
function crm38ContactRows(contacts=[]){
  return contacts.map((c,i)=>`<div class="crm38-contact-row"><select class="crm38-contact-role"><option ${c.contact_role==='임차인'?'selected':''}>임차인</option><option ${c.contact_role==='관리자'?'selected':''}>관리자</option><option ${c.contact_role==='매수인'?'selected':''}>매수인</option><option ${c.contact_role==='기타'?'selected':''}>기타</option></select><input class="crm38-contact-name" placeholder="성명/메모" value="${escapeHtml(c.contact_name||'')}"><input class="crm38-contact-phone" placeholder="010-0000-0000" value="${escapeHtml(c.phone||'')}"><button type="button" class="danger" onclick="this.closest('.crm38-contact-row').remove()">삭제</button></div>`).join('');
}
function crm38AddContactRow(){const box=$('#crm38ExtraContacts');box.insertAdjacentHTML('beforeend',crm38ContactRows([{contact_role:'임차인'}]));}
function crm38DealBlock(type,label,checked,opt={}){
  const priceLabel=type==='매매'?'매매가(만원)':type==='전세'?'전세금(만원)':'보증금(만원)';
  return `<div class="crm38-deal-card" data-type="${type}"><div class="crm38-deal-head"><label class="inline-check"><input type="checkbox" class="crm38-deal-check" value="${type}" ${checked?'checked':''} onchange="crm38SyncDealCards()"> ${label}</label><label class="inline-check preferred"><input type="radio" name="crm38_preferred" value="${type}" ${opt.is_preferred?'checked':''} ${checked?'':'disabled'}> 선호유형</label></div><div class="crm38-deal-fields" ${checked?'':'hidden'}><label>${priceLabel}<input class="crm38-deal-price" type="number" min="0" value="${opt.price??''}"></label>${type==='월세'?`<label>월세(만원)<input class="crm38-deal-rent" type="number" min="0" value="${opt.monthly_rent??''}"></label>`:''}</div></div>`;
}
function crm38SyncDealCards(){
  const cards=[...document.querySelectorAll('.crm38-deal-card')];cards.forEach(card=>{const on=card.querySelector('.crm38-deal-check').checked;card.querySelector('.crm38-deal-fields').hidden=!on;const r=card.querySelector('input[type=radio]');r.disabled=!on;if(!on)r.checked=false});
  const active=cards.filter(c=>c.querySelector('.crm38-deal-check').checked);if(active.length&&!active.some(c=>c.querySelector('input[type=radio]').checked))active[0].querySelector('input[type=radio]').checked=true;
}
openListingModal=function(id){
  const x=state.listings.find(v=>v.id===id)||{};const optMap=Object.fromEntries(crm38DealOptions(x).map(o=>[o.deal_type,o]));const contacts=x.additional_contacts||[];
  $('#modalTitle').textContent=id?'매물 수정':'매물 등록';
  $('#modalBody').innerHTML=`<div class="form-grid">
  <label>매물명<input name="title" value="${escapeHtml(x.title||'')}" required></label>
  <label>소유주 연락처<div class="inline-field"><input name="contact_phone" value="${escapeHtml(x.contact_phone||'')}" placeholder="소유주 번호가 없으면 비워두세요"><button type="button" class="ghost" onclick="crm38AddContactRow()">+ 번호 추가</button></div></label>
  <div id="crm38ExtraContacts" class="span-2 crm38-extra-contacts">${crm38ContactRows(contacts)}</div>
  <div class="span-2 crm38-deal-section"><div class="section-title">거래유형 및 금액</div><div class="field-help">가능한 거래유형을 모두 체크하고, 가장 우선적으로 권하는 유형에 ‘선호유형’을 체크하세요.</div>${crm38DealBlock('매매','매매',!!optMap['매매'],optMap['매매']||{})}${crm38DealBlock('전세','전세',!!optMap['전세'],optMap['전세']||{})}${crm38DealBlock('월세','월세',!!optMap['월세'],optMap['월세']||{})}</div>
  <label>매물 유형<select name="property_type"><option>아파트</option><option>오피스텔</option><option>빌라</option><option>원룸</option><option>상가</option><option>사무실</option><option>토지</option><option>기타</option></select></label>
  <label>상태<select name="status"><option value="available">거래 가능</option><option value="hold">협의 중</option><option value="complete">거래 완료</option></select></label>
  <label>지역<input name="district" value="${escapeHtml(x.district||'')}" placeholder="예: 서울 강서구 화곡동"></label><label class="span-2">주소<input name="address" value="${escapeHtml(x.address||'')}"></label>
  <label>관리비(만원)<input name="management_fee" type="number" step="0.1" value="${x.management_fee??''}"></label><label>전용면적(㎡)<input id="listingAreaM2" name="area_m2" type="number" step="0.01" value="${x.area_m2||''}"><span id="listingAreaPyeong" class="field-help">${x.area_m2?`약 ${(Number(x.area_m2)/3.3058).toFixed(2)}평`:'㎡를 입력하면 평으로 자동 계산됩니다.'}</span></label>
  <label>방 개수<div class="inline-field"><input id="listingRoomCountInput" name="room_count" type="number" min="0" step="1" value="${x.room_count??''}" placeholder="예: 3"><label class="inline-check"><input id="listingOnePointFiveCheck" name="is_one_point_five_room" type="checkbox" ${x.is_one_point_five_room?'checked':''}> 1.5룸</label></div></label><label>화장실 개수<input name="bathroom_count" type="number" min="0" step="1" value="${x.bathroom_count??''}"></label>
  <label class="span-2">옵션<input name="options" value="${escapeHtml(x.options||'')}" placeholder="예: 에어컨, 냉장고, 세탁기, 붙박이장"></label>
  <label>대출 가능 여부<select id="listingLoanAvailable" name="loan_available"><option value="">미확인</option><option value="true">O</option><option value="false">X</option></select></label><label id="listingOfficialPriceWrap">공시지가/기준시가(만원)<input name="official_price" type="number" value="${x.official_price||''}"></label>
  <div class="span-2 crm382-movein-box"><div class="section-title">입주 조건</div><div class="crm382-movein-grid"><label>입주 가능일<input id="moveInDateInput" name="move_in_date" type="date" value="${x.move_in_date||''}"></label><label class="check-label"><input id="moveInImmediate" name="move_in_immediate" type="checkbox" ${x.move_in_immediate?'checked':''}> 즉시입주</label><label class="check-label"><input id="moveInNegotiable" name="move_in_negotiable" type="checkbox" ${x.move_in_negotiable?'checked':''}> 협의 가능</label></div><span class="field-help">즉시입주는 날짜 입력 없이 저장됩니다. 협의 가능은 기준 날짜를 선택하면 목록에 날짜와 함께 표시됩니다.</span></div>
  <label>공개 여부<select name="is_public"><option value="true">공개</option><option value="false">비공개</option></select></label>
  <label>최종 확인일<input type="date" value="${(x.last_confirmed_at||x.last_follow_up_at||'').slice(0,10)}" readonly><span class="field-help">매물 히스토리의 가장 최근 날짜로 자동 변경됩니다.</span></label><label>다음 확인 예정일<input name="next_confirm_at" type="date" value="${x.next_confirm_at?x.next_confirm_at.slice(0,10):dateInDays(14)}"></label>
  <details class="span-2 crm361-form-section" open><summary>매물 특징</summary><div class="crm36-check-grid crm361-feature-grid">${CRM36_LISTING_FEATURES.map(tag=>`<label class="inline-check"><input type="checkbox" class="crm361-feature-check" value="${tag}" ${crm36Array(x.feature_tags).includes(tag)?'checked':''}> ${tag}</label>`).join('')}</div><div class="field-help">반려동물은 여기의 ‘반려동물 가능’ 체크로만 관리합니다.</div></details>
  <label class="span-2">내부 사진 추가<input id="listingPhotoFiles" type="file" accept="image/*" multiple><span class="field-help">여러 장 선택 가능 · 등록 후 사진 화면에서 한눈에 확인할 수 있습니다.</span></label><label class="span-2">상세설명(비밀메모)<textarea name="description" rows="5" placeholder="중개사 내부에서만 확인하는 메모입니다.">${escapeHtml(x.description||'')}</textarea><span class="field-help">고객용 소개서와 카카오톡 추천문구에는 표시되지 않습니다.</span></label></div>`;
  ['property_type','status'].forEach(n=>{const el=$(`#modalBody [name=${n}]`);el.value=x[n]||({property_type:'아파트',status:'available'}[n])});$('#modalBody [name=is_public]').value=String(x.is_public!==false);
  const loan=$('#listingLoanAvailable');loan.value=x.loan_available===true?'true':x.loan_available===false?'false':'';const toggle=()=>{$('#listingOfficialPriceWrap').style.display=loan.value==='true'?'':'none'};loan.onchange=toggle;toggle();
  const ri=$('#listingRoomCountInput'),r15=$('#listingOnePointFiveCheck');const sync=()=>{if(r15.checked){ri.value='1';ri.disabled=true}else ri.disabled=false};r15.onchange=sync;sync();crm38SyncDealCards();
  const areaInput=$('#listingAreaM2'),areaPyeong=$('#listingAreaPyeong');const syncArea=()=>{const v=Number(areaInput?.value||0);if(areaPyeong)areaPyeong.textContent=v?`약 ${(v/3.3058).toFixed(2)}평`:'㎡를 입력하면 평으로 자동 계산됩니다.'};if(areaInput)areaInput.addEventListener('input',syncArea);syncArea();
  const moveDate=$('#moveInDateInput'),moveImmediate=$('#moveInImmediate'),moveNegotiable=$('#moveInNegotiable');const syncMoveIn=(source)=>{if(source==='immediate'&&moveImmediate.checked)moveNegotiable.checked=false;if(source==='negotiable'&&moveNegotiable.checked)moveImmediate.checked=false;const noDate=moveImmediate.checked;moveDate.disabled=noDate;if(noDate)moveDate.value='';if(moveNegotiable.checked&&!moveDate.value)moveDate.required=true;else moveDate.required=false};moveImmediate.onchange=()=>syncMoveIn('immediate');moveNegotiable.onchange=()=>syncMoveIn('negotiable');syncMoveIn();
  $('#modalSubmit').style.display='';$('#modalSubmit').onclick=async e=>{e.preventDefault();const fd=new FormData($('#modalForm'));const selected=[...document.querySelectorAll('.crm38-deal-card')].filter(c=>c.querySelector('.crm38-deal-check').checked).map((c,i)=>({deal_type:c.dataset.type,price:Number(c.querySelector('.crm38-deal-price').value||0)||null,monthly_rent:c.dataset.type==='월세'?(Number(c.querySelector('.crm38-deal-rent').value||0)||null):null,is_preferred:c.querySelector('input[type=radio]').checked,sort_order:i}));if(!selected.length)return toast('거래유형을 하나 이상 체크하세요.');const preferred=selected.find(o=>o.is_preferred)||selected[0];const p={title:fd.get('title'),contact_phone:fd.get('contact_phone')||null,transaction_type:preferred.deal_type,price:preferred.price,monthly_rent:preferred.monthly_rent,property_type:fd.get('property_type'),status:fd.get('status'),district:fd.get('district')||null,address:fd.get('address')||null,management_fee:Number(fd.get('management_fee')||0)||null,area_m2:Number(fd.get('area_m2')||0)||null,room_count:Number(fd.get('room_count')||0)||null,bathroom_count:Number(fd.get('bathroom_count')||0)||null,options:fd.get('options')||null,loan_available:fd.get('loan_available')===''?null:fd.get('loan_available')==='true',official_price:Number(fd.get('official_price')||0)||null,move_in_immediate:fd.get('move_in_immediate')==='on',move_in_negotiable:fd.get('move_in_negotiable')==='on',move_in_date:fd.get('move_in_immediate')==='on'?null:(fd.get('move_in_date')||null),is_public:fd.get('is_public')==='true',next_confirm_at:fd.get('next_confirm_at')||null,description:fd.get('description')||null,owner_id:id?(x.owner_id||state.profile.id):state.profile.id,feature_tags:[...document.querySelectorAll('.crm361-feature-check:checked')].map(el=>el.value),is_one_point_five_room:fd.get('is_one_point_five_room')==='on'};if(p.is_one_point_five_room)p.room_count=1;if(!p.loan_available)p.official_price=null;
    let listingId=id;if(id){const {error}=await state.client.from('listings').update(p).eq('id',id);if(error)return toast(error.message)}else{const {data,error}=await state.client.from('listings').insert(p).select('id').single();if(error)return toast(error.message);listingId=data.id}
    await state.client.from('listing_deal_options').delete().eq('listing_id',listingId);const {error:dealErr}=await state.client.from('listing_deal_options').insert(selected.map(o=>({...o,listing_id:listingId})));if(dealErr)return toast(dealErr.message);
    await state.client.from('listing_contacts').delete().eq('listing_id',listingId);const extra=[...document.querySelectorAll('.crm38-contact-row')].map((row,i)=>({listing_id:listingId,contact_role:row.querySelector('.crm38-contact-role').value,contact_name:row.querySelector('.crm38-contact-name').value||null,phone:row.querySelector('.crm38-contact-phone').value,sort_order:i})).filter(c=>c.phone);if(extra.length){const {error}=await state.client.from('listing_contacts').insert(extra);if(error)return toast(error.message)}
    const files=$('#listingPhotoFiles')?.files;let photoResult={uploaded:0,failed:0};if(files?.length)photoResult=await uploadListingPhotos(listingId,files);$('#modal').close();toast(`저장했습니다.${photoResult.uploaded?` 사진 ${photoResult.uploaded}장 등록.`:''}`);state.view==='adminListings'?renderAdminListings():renderMyListings()};$('#modal').showModal();
};
openListingPhotos=async function(listingId){
  const listing=state.listings.find(x=>x.id===listingId);if(!listing)return toast('매물을 찾지 못했습니다.');$('#modalTitle').textContent=`내부 사진 · ${listing.title}`;
  const {data,error}=await state.client.from('listing_photos').select('*').eq('listing_id',listingId).order('sort_order').order('created_at');if(error)return toast(error.message);const photos=data||[];const cards=[];
  for(const p of photos){const url=await signedPhotoUrl(p.storage_path);cards.push(`<div class="photo-card crm38-photo-card ${listing.cover_photo_id===p.id?'cover':''}">${url?`<img src="${url}" onclick="window.open('${url}','_blank')" alt="매물 사진">`:''}<div class="photo-meta crm38-photo-meta"><input value="${escapeHtml(p.caption||'')}" placeholder="사진 설명" onchange="updatePhotoMeta('${p.id}','caption',this.value)"><select onchange="updatePhotoMeta('${p.id}','photo_category',this.value)">${['거실','주방','방','화장실','외관','뷰','기타'].map(c=>`<option ${p.photo_category===c?'selected':''}>${c}</option>`).join('')}</select><label><input type="checkbox" ${p.is_customer_visible?'checked':''} onchange="updatePhotoMeta('${p.id}','is_customer_visible',this.checked)"> 고객용 공개</label><input type="number" value="${p.sort_order||0}" onchange="updatePhotoMeta('${p.id}','sort_order',Number(this.value))"><button onclick="setCoverPhoto('${listing.id}','${p.id}')">대표사진</button>${canManageListing(listing)?`<button class="danger" onclick="deleteListingPhoto('${listing.id}','${p.id}','${p.storage_path}')">삭제</button>`:''}</div></div>`)}
  $('#modalBody').innerHTML=`<div class="photo-toolbar"><div><strong>${photos.length}장</strong><div class="muted">사진을 누르면 원본 크기로 볼 수 있습니다.</div></div><div><button class="ghost" onclick="crm38TogglePhotoManage(this)">사진 관리</button><button class="ghost" onclick="downloadAllListingPhotos('${listing.id}')">전체 ZIP 다운로드</button>${canManageListing(listing)?`<button class="primary" onclick="addListingPhotos('${listing.id}')">사진 추가</button>`:''}</div></div><div class="photo-grid crm38-photo-grid">${cards.join('')||'<div class="empty">등록된 사진이 없습니다.</div>'}</div>`;$('#modalSubmit').style.display='none';const reset=()=>{$('#modalSubmit').style.display='';$('#modal').removeEventListener('close',reset)};$('#modal').addEventListener('close',reset);$('#modal').showModal();
};
function crm38TogglePhotoManage(btn){const on=$('#modalBody').classList.toggle('photo-manage-on');btn.textContent=on?'사진만 보기':'사진 관리'}
renderListingTable=function(rows,target,mine,adminMode=false){const el=$('#'+target);el.innerHTML=rows.length?`<div class="table-wrap listing-table-wrap"><table class="listing-table"><thead><tr>${adminMode?'<th class="select-col">선택</th>':''}<th>상태</th><th>거래</th><th>유형</th><th>매물명</th><th>지역</th><th>금액</th><th>연락처</th><th>대출</th><th>전용면적</th><th>방/욕실</th><th>입주</th><th>담당</th><th>진행상황</th><th>최종 FU</th><th>예정 FU</th>${mine?'<th>관리</th>':''}</tr></thead><tbody>${rows.map(x=>`<tr>${adminMode?`<td><input type="checkbox" class="admin-listing-check" value="${x.id}" onchange="toggleAdminListingSelection('${x.id}',this.checked)"></td>`:''}<td class="crm3812-status-cell"><div class="crm3812-list-address" title="${escapeHtml(x.address||x.district||'주소 미입력')}">${escapeHtml(x.address||x.district||'주소 미입력')}</div>${badge(x.status==='available'?'거래 가능':x.status==='complete'?'거래 완료':'협의 중',x.status==='available'?'green':x.status==='complete'?'gray':'yellow')}</td><td>${escapeHtml(crm38DealTypeText(x))}</td><td>${escapeHtml(x.property_type)}</td><td><button type="button" class="crm3814-listing-title-link" onclick="openListingDetail('${x.id}')" title="매물 상세정보 보기">${escapeHtml(x.title)}</button>${x.is_public?'':' '+badge('비공개','red')}<br><button class="photo-link" onclick="openListingPhotos('${x.id}')">📷 내부사진</button></td><td>${escapeHtml(listingAreaText(x))}</td><td>${listingPriceText(x)}</td><td>${crm382ContactDisplay(x)}</td><td>${x.loan_available===true?badge('O','green'):x.loan_available===false?badge('X','red'):badge('미확인','gray')}</td><td>${x.area_m2?`${x.area_m2}㎡<br><span class="muted">약 ${(Number(x.area_m2)/3.3058).toFixed(2)}평</span>`:'-'}</td><td>${listingRoomText(x)} / ${x.bathroom_count??'-'}</td><td>${moveInText(x)}</td><td>${escapeHtml(x.owner?.full_name||'-')}</td><td>${contractStage(x)}</td><td>${fmtDate(x.last_follow_up_at||x.last_confirmed_at)}</td><td>${dueBadge(x.next_follow_up_at)}</td>${mine?`<td><div class="row-actions"><button class="success" onclick="openFollowUpModal('listing','${x.id}')">FU</button><button class="ghost" onclick="openHistoryModal('listing','${x.id}')">히스토리</button><button class="ghost" onclick="openContractModal('listing','${x.id}')">진행상황</button><button class="ghost" onclick="openListingModal('${x.id}')">수정</button>${adminMode?`<button class="primary" onclick="openSingleListingTransfer('${x.id}')">개별 이관</button>`:''}<button class="danger" onclick="deleteListing('${x.id}')">삭제</button></div></td>`:''}</tr>`).join('')}</tbody></table></div>`:'<div class="empty">조건에 맞는 매물이 없습니다.</div>';if(adminMode)updateBulkTransferControls()};
Object.assign(window,{openListingModal,openListingPhotos,crm38AddContactRow,crm38SyncDealCards,crm38TogglePhotoManage,renderListingTable});
console.info('CRM v3.8 매물 입력·사진·복수거래 개선 로드 완료');

/* ===== CRM v3.8.1 연락처·확인일·카카오·소개서 개선 ===== */
function crm381FormatPhone(value){
  const raw=String(value??'').trim();
  if(!raw)return '';
  const d=raw.replace(/\D/g,'').slice(0,11);
  if(!d)return raw;
  if(d.startsWith('02')){
    if(d.length<=2)return d;
    if(d.length<=5)return `${d.slice(0,2)}-${d.slice(2)}`;
    if(d.length<=9)return `${d.slice(0,2)}-${d.slice(2,d.length-4)}-${d.slice(-4)}`;
    return `${d.slice(0,2)}-${d.slice(2,6)}-${d.slice(6,10)}`;
  }
  if(d.length<=3)return d;
  if(d.length<=7)return `${d.slice(0,3)}-${d.slice(3)}`;
  if(d.length===10)return `${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6)}`;
  return `${d.slice(0,3)}-${d.slice(3,7)}-${d.slice(7,11)}`;
}
function crm381PhoneInput(el){
  const pos=el.selectionStart, before=el.value;
  el.value=crm381FormatPhone(before);
  try{el.setSelectionRange(el.value.length,el.value.length)}catch(_){ }
}
function crm381IsPhoneInput(el){
  if(!(el instanceof HTMLInputElement))return false;
  const key=`${el.name||''} ${el.id||''} ${el.className||''} ${el.placeholder||''}`.toLowerCase();
  return key.includes('phone')||key.includes('연락처')||key.includes('010-');
}
document.addEventListener('input',e=>{if(crm381IsPhoneInput(e.target))crm381PhoneInput(e.target)});
document.addEventListener('focusin',e=>{if(crm381IsPhoneInput(e.target)&&e.target.value)e.target.value=crm381FormatPhone(e.target.value)});

const crm381BaseLoadCustomers=loadCustomers;
loadCustomers=async function(){
  await crm381BaseLoadCustomers();
  (state.customers||[]).forEach(x=>{x.phone=crm381FormatPhone(x.phone);if(x.counterparty_phone)x.counterparty_phone=crm381FormatPhone(x.counterparty_phone)});
};
const crm381BaseLoadListings=loadListings;
loadListings=async function(){
  await crm381BaseLoadListings();
  (state.listings||[]).forEach(x=>{
    x.contact_phone=crm381FormatPhone(x.contact_phone);
    if(x.owner?.phone)x.owner.phone=crm381FormatPhone(x.owner.phone);
    (x.additional_contacts||[]).forEach(c=>c.phone=crm381FormatPhone(c.phone));
  });
  (state.listingContacts||[]).forEach(c=>c.phone=crm381FormatPhone(c.phone));
  state.myListings=(state.listings||[]).filter(x=>x.owner_id===state.profile?.id);
};
function crm381AddOneMonth(dateValue){
  const base=dateValue?new Date(`${String(dateValue).slice(0,10)}T12:00:00`):new Date();
  if(Number.isNaN(base.getTime()))return '';
  const day=base.getDate();base.setDate(1);base.setMonth(base.getMonth()+1);const last=new Date(base.getFullYear(),base.getMonth()+1,0).getDate();base.setDate(Math.min(day,last));
  return `${base.getFullYear()}-${String(base.getMonth()+1).padStart(2,'0')}-${String(base.getDate()).padStart(2,'0')}`;
}
const crm381BaseOpenListingModal=openListingModal;
openListingModal=async function(id=null){
  await crm381BaseOpenListingModal(id);
  const x=id?state.listings.find(v=>v.id===id):{};
  const base=[x?.last_confirmed_at,x?.last_follow_up_at].filter(Boolean).sort().at(-1)||today();
  const lastInput=[...document.querySelectorAll('#modalBody input[type=date]')].find(el=>el.parentElement?.textContent?.includes('최종 확인일'));
  const nextInput=document.querySelector('#modalBody [name=next_confirm_at]');
  if(lastInput)lastInput.value=String(base).slice(0,10);
  if(nextInput){nextInput.value=crm381AddOneMonth(base);nextInput.readOnly=true;nextInput.title='최종 확인일로부터 한 달 뒤 자동 설정';const help=document.createElement('span');help.className='field-help';help.textContent='최종 확인일로부터 한 달 뒤로 자동 설정됩니다.';if(!nextInput.parentElement.querySelector('.crm381-next-help')){help.classList.add('crm381-next-help');nextInput.parentElement.appendChild(help)}}
  document.querySelectorAll('#modalBody input').forEach(el=>{if(crm381IsPhoneInput(el)&&el.value)el.value=crm381FormatPhone(el.value)});
};

crm36KakaoMessage=function(customerId){
  const customer=state.customers.find(x=>x.id===customerId);const rows=state.listings.filter(x=>state.matchSelection.has(x.id));if(!rows.length)return toast('카카오톡 문구에 넣을 매물을 먼저 체크하세요.');
  const lines=[`안녕하세요, ${customer.name} 고객님.`,`말씀해주신 조건을 기준으로 현재 확인 가능한 매물을 정리해드렸습니다.`,``,`[고객님 희망 조건]`,`• 거래유형: ${customer.deal_type||customer.customer_type||'-'}`,`• 희망금액: ${fmtMoney(customer.budget_max)}`,`• 희망 방 개수: ${customerRoomText(customer)}`,customer.desired_monthly_rent?`• 희망 월세: 월 ${fmtMoney(customer.desired_monthly_rent)}`:'',customer.preferred_area?`• 선호지역: ${customer.preferred_area}`:'',``,`[추천 매물 ${rows.length}건]`].filter(Boolean);
  rows.forEach((x,i)=>{const tags=crm36Array(x.feature_tags);lines.push(``,`${i+1}. ${x.title}`,`• 거래조건: ${crm38DealTypeText(x)} / ${listingPriceText(x).replace(/<br>/g,' · ')}`,`• 위치: ${[x.district,x.address].filter(Boolean).join(' ')||'-'}`,`• 구조: 방 ${listingRoomText(x)} / 욕실 ${x.bathroom_count??'-'}개`,x.area_m2?`• 전용면적: ${x.area_m2}㎡`:'',x.management_fee?`• 관리비: ${fmtMoney(x.management_fee)}`:'',x.move_in_immediate?'• 입주: 즉시입주 가능':x.move_in_date&&x.move_in_negotiable?`• 입주 가능일: ${fmtDate(x.move_in_date)} (협의 가능)`:x.move_in_date?`• 입주 가능일: ${fmtDate(x.move_in_date)}`:x.move_in_negotiable?'• 입주: 협의 가능':'',tags.length?`• 특징: ${tags.join(', ')}`:'',x.options?`• 옵션: ${x.options}`:'').filter(Boolean)});
  lines.push(``,`※ 매물은 실시간으로 계약되거나 금액·입주조건이 변경될 수 있어 방문 전 다시 확인해드리겠습니다.`,`관심 가는 매물 번호를 알려주시면 공개 가능한 내부사진과 세부 조건을 보내드리고 방문 일정을 조율해드리겠습니다.`,``,`담당 중개사: ${state.profile.full_name||''}`,state.profile.office_name?`소속: ${state.profile.office_name}`:'',state.profile.phone?`연락처: ${crm381FormatPhone(state.profile.phone)}`:'');
  const text=lines.filter(Boolean).join('\n');$('#modalTitle').textContent='카카오톡 추천 문구';$('#modalBody').innerHTML=`<textarea id="crm36KakaoText" rows="24" style="width:100%">${escapeHtml(text)}</textarea><div class="notice" style="margin-top:12px">문구를 확인한 뒤 복사하세요. 브라우저 복사가 차단되면 자동으로 선택되므로 Ctrl+C 또는 길게 눌러 복사할 수 있습니다.</div>`;$('#modalSubmit').textContent='문구 복사';$('#modalSubmit').style.display='';$('#modalSubmit').onclick=async e=>{e.preventDefault();const ta=$('#crm36KakaoText');let copied=false;try{if(navigator.clipboard&&window.isSecureContext){await navigator.clipboard.writeText(ta.value);copied=true}}catch(_){ }if(!copied){ta.focus();ta.select();try{copied=document.execCommand('copy')}catch(_){copied=false}}toast(copied?'카카오톡 문구를 복사했습니다.':'문구가 선택되었습니다. Ctrl+C 또는 길게 눌러 복사하세요.');if(copied)$('#modal').close()};const reset=()=>{$('#modalSubmit').textContent='저장';$('#modal').removeEventListener('close',reset)};$('#modal').addEventListener('close',reset);$('#modal').showModal();
};

printSelectedListingBrochure=async function(customerId){
  const customer=state.customers.find(x=>x.id===customerId),rows=state.listings.filter(x=>state.matchSelection.has(x.id));if(!rows.length)return toast('소개서에 넣을 매물을 선택하세요.');
  const w=window.open('','_blank');if(!w)return toast('팝업이 차단되었습니다. 이 사이트의 팝업을 허용해주세요.');w.document.write('<p style="font-family:sans-serif;padding:30px">매물 사진과 소개서를 준비하고 있습니다...</p>');
  const cards=[];
  for(const x of rows){
    const {data:photos}=await state.client.from('listing_photos').select('*').eq('listing_id',x.id).eq('is_customer_visible',true).order('sort_order').order('created_at');
    const ordered=[...(photos||[])];const coverIndex=ordered.findIndex(p=>p.id===x.cover_photo_id);if(coverIndex>0)ordered.unshift(ordered.splice(coverIndex,1)[0]);
    const urls=[];for(const p of ordered.slice(0,5)){const u=await signedPhotoUrl(p.storage_path);if(u)urls.push(u)}
    const photoHtml=urls.length?`<div class="property-photos count-${urls.length}">${urls.map((u,i)=>`<img src="${u}" alt="${escapeHtml(x.title)} 사진 ${i+1}">`).join('')}</div>`:`<div class="no-photo">사진 없음</div>`;
    cards.push(`<section class="property"><div class="property-info"><h2>${escapeHtml(x.title)}</h2><p class="price"><b>${escapeHtml(crm38DealTypeText(x))}</b> ${listingPriceText(x)}</p><p>${escapeHtml([x.district,x.address].filter(Boolean).join(' ')||'-')}</p><p>전용면적 ${x.area_m2||'-'}㎡${x.area_m2?` (약 ${(Number(x.area_m2)/3.3058).toFixed(2)}평)`:''} · 방 ${listingRoomText(x)} · 욕실 ${x.bathroom_count??'-'}</p>${x.management_fee?`<p>관리비 ${fmtMoney(x.management_fee)}</p>`:''}</div>${photoHtml}</section>`)
  }
  w.document.open();w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(customer.name)} 매물소개서</title><style>body{font-family:Arial,'Noto Sans KR',sans-serif;max-width:980px;margin:auto;padding:30px;color:#111}header{border-bottom:3px solid #111;padding-bottom:18px;margin-bottom:16px}small{color:#666}.property{page-break-inside:avoid;border-bottom:2px solid #ddd;padding:24px 0}.property h2{margin:0 0 12px;font-size:25px}.property p{margin:8px 0;line-height:1.55}.price{font-size:17px}.desc{color:#444}.property-photos{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:18px}.property-photos img{width:100%;height:155px;object-fit:cover;border-radius:9px;background:#eee}.property-photos img:first-child{grid-column:span 2;grid-row:span 2;height:318px}.property-photos.count-1{grid-template-columns:1fr}.property-photos.count-1 img:first-child{grid-column:auto;grid-row:auto;height:400px;object-fit:contain}.property-photos.count-2{grid-template-columns:repeat(2,1fr)}.property-photos.count-2 img:first-child{grid-column:auto;grid-row:auto;height:240px}.property-photos.count-2 img{height:240px}.no-photo{height:120px;display:grid;place-items:center;background:#f3f4f6;border:1px dashed #bbb;border-radius:10px;color:#777;font-weight:700;margin-top:18px}@media print{body{padding:0}.property-photos img{print-color-adjust:exact;-webkit-print-color-adjust:exact}}</style></head><body><header><h1>${escapeHtml(customer.name)} 고객님 추천 매물</h1><small>소유자 연락처와 내부 메모는 제외된 고객용 자료입니다.</small></header>${cards.join('')}<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),900))<\/script></body></html>`);w.document.close();
};

Object.assign(window,{crm381FormatPhone,crm36KakaoMessage,printSelectedListingBrochure,openListingModal});
console.info('CRM v3.8.1 연락처·확인일·카카오·소개서 개선 로드 완료');


/* ===== CRM v3.8.2 연락처·입주·전용면적·비밀메모 정리 ===== */
function crm382ContactDisplay(x){
  const rows=[];
  if(x.contact_phone)rows.push(`<div><strong>소유주</strong> ${escapeHtml(crm381FormatPhone(x.contact_phone))}</div>`);
  (x.additional_contacts||[]).forEach(c=>{if(c.phone)rows.push(`<div><strong>${escapeHtml(c.contact_role||'기타')}</strong>${c.contact_name?` <span class="muted">${escapeHtml(c.contact_name)}</span>`:''}<br>${escapeHtml(crm381FormatPhone(c.phone))}</div>`)});
  return rows.length?rows.join('<div class="crm382-contact-gap"></div>'):'-';
}
Object.assign(window,{crm382ContactDisplay});
console.info('CRM v3.8.2 연락처·입주·전용면적·비밀메모 개선 로드 완료');

console.info('CRM v3.8.3 입주 협의 날짜 표시 개선 로드 완료');

/* ===== CRM v3.8.4 연락처 정렬·폼 정렬·카카오톡 직접복사 ===== */
function crm384ContactDisplay(x){
  const rows=[];
  if(x.contact_phone){
    rows.push(`<div class="crm384-contact-item"><strong>소유주</strong><span>${escapeHtml(crm381FormatPhone(x.contact_phone))}</span></div>`);
  }
  (x.additional_contacts||[]).forEach(c=>{
    if(!c.phone)return;
    rows.push(`<div class="crm384-contact-item"><strong>${escapeHtml(c.contact_role||'기타')}</strong><span>${escapeHtml(crm381FormatPhone(c.phone))}</span></div>`);
  });
  return rows.length?`<div class="crm384-contact-list">${rows.join('')}</div>`:'-';
}

// 표의 연락처 표현을 세로 정렬 형식으로 통일
crm382ContactDisplay=crm384ContactDisplay;

async function crm384CopyText(text){
  // HTTPS 환경에서는 표준 Clipboard API를 우선 사용
  try{
    if(navigator.clipboard && window.isSecureContext){
      await navigator.clipboard.writeText(text);
      return true;
    }
  }catch(_){ }

  // 모바일/구형 브라우저용 폴백
  const ta=document.createElement('textarea');
  ta.value=text;
  ta.setAttribute('readonly','');
  ta.style.position='fixed';
  ta.style.left='-9999px';
  ta.style.top='0';
  ta.style.opacity='0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  ta.setSelectionRange(0,ta.value.length);
  let ok=false;
  try{ok=document.execCommand('copy')}catch(_){ok=false}
  ta.remove();
  return ok;
}

function crm384KakaoText(customer,rows){
  const lines=[
    `안녕하세요, ${customer.name} 고객님.`,
    `말씀해주신 조건을 기준으로 현재 확인 가능한 추천 매물을 정리해드렸습니다.`,
    ``,
    `[고객님 희망 조건]`,
    `• 거래유형: ${customer.deal_type||customer.customer_type||'-'}`,
    `• 희망금액: ${fmtMoney(customer.budget_max)}`,
    `• 희망 방 개수: ${customerRoomText(customer)}`,
    customer.desired_monthly_rent?`• 희망 월세: 월 ${fmtMoney(customer.desired_monthly_rent)}`:'',
    customer.preferred_area?`• 선호지역: ${customer.preferred_area}`:'',
    ``,
    `[추천 매물 ${rows.length}건]`
  ].filter(Boolean);

  rows.forEach((x,i)=>{
    const tags=crm36Array(x.feature_tags);
    const priceText=String(listingPriceText(x)||'').replace(/<br\s*\/?\s*>/gi,' · ').replace(/<[^>]+>/g,'');
    const item=[
      ``,
      `${i+1}. ${x.title}`,
      `• 거래조건: ${crm38DealTypeText(x)} / ${priceText}`,
      `• 위치: ${[x.district,x.address].filter(Boolean).join(' ')||'-'}`,
      `• 구조: 방 ${listingRoomText(x)} / 욕실 ${x.bathroom_count??'-'}개`,
      x.area_m2?`• 전용면적: ${x.area_m2}㎡ (약 ${(Number(x.area_m2)/3.3058).toFixed(2)}평)`: '',
      x.management_fee?`• 관리비: ${fmtMoney(x.management_fee)}`:'',
      x.move_in_immediate?'• 입주: 즉시입주 가능':x.move_in_date&&x.move_in_negotiable?`• 입주: ${fmtDate(x.move_in_date)}부터 협의 가능`:x.move_in_date?`• 입주 가능일: ${fmtDate(x.move_in_date)}`:'',
      tags.length?`• 특징: ${tags.join(', ')}`:'',
      x.options?`• 옵션: ${x.options}`:''
    ].filter(Boolean);
    lines.push(...item);
  });

  lines.push(
    ``,
    `※ 매물은 실시간으로 계약되거나 금액·입주 조건이 변경될 수 있어 방문 전 다시 확인해드리겠습니다.`,
    `관심 가는 매물 번호를 말씀해주시면 공개 가능한 사진과 세부 조건을 안내드리고 방문 일정을 조율해드리겠습니다.`,
    ``,
    `담당 중개사: ${state.profile.full_name||''}`,
    state.profile.office_name?`소속: ${state.profile.office_name}`:'',
    state.profile.phone?`연락처: ${crm381FormatPhone(state.profile.phone)}`:''
  );
  return lines.filter(Boolean).join('\n');
}

// 버튼을 누르면 별도 팝업 없이 즉시 텍스트를 클립보드에 복사
crm36KakaoMessage=async function(customerId){
  const customer=state.customers.find(x=>x.id===customerId);
  if(!customer)return toast('고객 정보를 찾지 못했습니다.');
  const rows=state.listings.filter(x=>state.matchSelection.has(x.id));
  if(!rows.length)return toast('카카오톡 문구에 넣을 매물을 먼저 체크하세요.');
  const text=crm384KakaoText(customer,rows);
  const copied=await crm384CopyText(text);
  if(copied){
    toast('카카오톡 추천문구를 클립보드에 복사했습니다.');
  }else{
    // 복사가 완전히 차단된 환경에서는 텍스트 창을 열어 수동 복사가 가능하도록 함
    $('#modalTitle').textContent='카카오톡 추천 문구';
    $('#modalBody').innerHTML=`<textarea id="crm384KakaoText" rows="24" style="width:100%">${escapeHtml(text)}</textarea><div class="notice" style="margin-top:12px">자동 복사가 차단되었습니다. 문구를 길게 누르거나 Ctrl+C로 복사하세요.</div>`;
    $('#modalSubmit').textContent='전체 선택';
    $('#modalSubmit').style.display='';
    $('#modalSubmit').onclick=e=>{e.preventDefault();const ta=$('#crm384KakaoText');ta.focus();ta.select();ta.setSelectionRange(0,ta.value.length)};
    $('#modal').showModal();
  }
};

Object.assign(window,{crm384ContactDisplay,crm384CopyText,crm36KakaoMessage});
console.info('CRM v3.8.4 연락처 정렬·폼 정렬·카카오톡 직접복사 로드 완료');

/* ===== CRM v3.8.5 FU 일정·복수 거래 가격이력 통합 ===== */
function crm385Num(v){return v===''||v===undefined||v===null?null:Number(v)}
function crm385Same(a,b){return crm385Num(a)===crm385Num(b)}
function crm385DealValueText(o){
  if(!o)return '없음';
  if(o.deal_type==='월세')return `${fmtMoney(o.price)} / 월 ${fmtMoney(o.monthly_rent)}`;
  return fmtMoney(o.price);
}
function crm385CollectDealOptions(){
  return [...document.querySelectorAll('.crm38-deal-card')]
    .filter(c=>c.querySelector('.crm38-deal-check')?.checked)
    .map((c,i)=>({deal_type:c.dataset.type,price:crm385Num(c.querySelector('.crm38-deal-price')?.value),monthly_rent:c.dataset.type==='월세'?crm385Num(c.querySelector('.crm38-deal-rent')?.value):null,is_preferred:!!c.querySelector('input[type=radio]')?.checked,sort_order:i}));
}
function crm385DiffDealOptions(oldOpts=[],newOpts=[]){
  const types=['매매','전세','월세'];const out=[];
  for(const type of types){
    const oldO=oldOpts.find(o=>o.deal_type===type)||null,newO=newOpts.find(o=>o.deal_type===type)||null;
    if(!oldO&&newO){out.push({kind:'add',type,oldO:null,newO});continue}
    if(oldO&&!newO){out.push({kind:'remove',type,oldO,newO:null});continue}
    if(oldO&&newO&&(!crm385Same(oldO.price,newO.price)||!crm385Same(oldO.monthly_rent,newO.monthly_rent))){out.push({kind:'change',type,oldO,newO})}
  }
  return out;
}
async function crm385RecordDealChanges(listingId,oldOpts,newOpts){
  const changes=crm385DiffDealOptions(oldOpts,newOpts);if(!changes.length)return;
  const rows=changes.map(c=>({listing_id:listingId,changed_by:state.profile.id,transaction_type:c.type,old_price:c.oldO?.price??null,new_price:c.newO?.price??null,old_monthly_rent:c.oldO?.monthly_rent??null,new_monthly_rent:c.newO?.monthly_rent??null}));
  const {error:pErr}=await state.client.from('listing_price_history').insert(rows);if(pErr)toast(`가격 이력 저장 실패: ${pErr.message}`);
  const lines=changes.map(c=>c.kind==='add'?`${c.type} 조건 추가 · ${crm385DealValueText(c.newO)}`:c.kind==='remove'?`${c.type} 조건 종료 · ${crm385DealValueText(c.oldO)}`:`${c.type} 가격 변경 · ${crm385DealValueText(c.oldO)} → ${crm385DealValueText(c.newO)}`);
  const {error:hErr}=await state.client.from('interaction_history').insert({created_by:state.profile.id,follow_up_date:today(),contact_method:'가격변동',content:lines.join('\n'),listing_id:listingId,next_follow_up_at:null});
  if(hErr)toast(`히스토리 저장 실패: ${hErr.message}`);else await state.client.from('listings').update({last_follow_up_at:today()}).eq('id',listingId);
}
async function crm385RecalcNextFu(listingId){
  const {data}=await state.client.from('interaction_history').select('next_follow_up_at').eq('listing_id',listingId).not('next_follow_up_at','is',null).gte('next_follow_up_at',today()).order('next_follow_up_at',{ascending:true}).limit(1);
  const next=data?.[0]?.next_follow_up_at||null;
  await state.client.from('listings').update({next_follow_up_at:next,next_confirm_at:null}).eq('id',listingId);
  return next;
}

const crm385BaseOpenListingModal=openListingModal;
openListingModal=function(id){
  const oldOpts=id?crm38DealOptions(state.listings.find(x=>x.id===id)).map(o=>({...o})):[];
  crm385BaseOpenListingModal(id);
  const nextInput=document.querySelector('#modalBody input[name="next_confirm_at"]');
  if(nextInput){const label=nextInput.closest('label');label?.nextElementSibling?.classList?.contains('field-help')&&label.nextElementSibling.remove();label?.remove()}
  const original=$('#modalSubmit').onclick;
  $('#modalSubmit').onclick=async e=>{
    const newOpts=crm385CollectDealOptions();
    await original(e);
    if(id&&!$('#modal').open){await crm385RecordDealChanges(id,oldOpts,newOpts);await loadListings()}
  };
};

crm361OpenListingFu=async function(id){
  const item=state.listings.find(x=>x.id===id);if(!item)return toast('매물을 찾지 못했습니다.');
  const opts=crm38DealOptions(item);
  $('#modalTitle').textContent=`${item.title} · FU 관리`;
  $('#modalBody').innerHTML=`<input id="crm361ListingId" type="hidden" value="${id}"><div class="crm361-fu-tabs"><button type="button" class="crm361-fu-tab active" data-tab="record" onclick="crm361SetFuTab('record')">FU 기록</button><button type="button" class="crm361-fu-tab" data-tab="confirm" onclick="crm361SetFuTab('confirm')">확인 전화</button><button type="button" class="crm361-fu-tab" data-tab="history" onclick="crm361SetFuTab('history')">가격 이력</button></div>
  <section class="crm361-fu-panel" data-panel="record"><div class="form-grid"><label>기록 일자<input id="crm361FuDate" type="date" value="${today()}" required></label><label>상담 종류<select id="crm361FuMethod"><option>전화</option><option>대면투어</option><option>촬영</option><option>문자/톡 발송</option><option>문자/톡 수신</option><option>부재중</option><option>가계약</option><option>본계약</option><option>중도금</option><option>잔금</option><option>기타</option></select></label><label class="span-2">상담·진행 내용<textarea id="crm361FuContent" rows="7" placeholder="통화 내용, 조건 변경, 다음 조치 등을 구체적으로 기록하세요."></textarea></label><label>예정 FU<input id="crm361FuNext" type="date" value="${item.next_follow_up_at?item.next_follow_up_at.slice(0,10):''}"></label></div></section>
  <section class="crm361-fu-panel hidden" data-panel="confirm"><div class="notice">확인 내용을 FU 히스토리에 저장합니다. 거래유형별 가격을 수정하면 가격 이력과 히스토리에 함께 기록됩니다.</div><div class="form-grid" style="margin-top:14px"><label>확인 결과<select id="crm361ConfirmResult"><option>거래 가능</option><option>가격 변경</option><option>협의 중</option><option>거래 완료</option><option>연락 안 됨</option><option>재확인 필요</option></select></label><label>예정 FU<input id="crm361NextConfirm" type="date" value="${item.next_follow_up_at?item.next_follow_up_at.slice(0,10):''}"></label><div class="span-2 crm385-confirm-deals">${opts.map(o=>`<div class="crm385-confirm-deal" data-type="${o.deal_type}" data-id="${o.id||''}"><strong>${o.deal_type}</strong><label>${o.deal_type==='매매'?'매매가':o.deal_type==='전세'?'전세금':'보증금'}(만원)<input class="crm385-confirm-price" type="number" value="${o.price??''}"></label>${o.deal_type==='월세'?`<label>월세(만원)<input class="crm385-confirm-rent" type="number" value="${o.monthly_rent??''}"></label>`:''}</div>`).join('')}</div><label class="span-2">통화 내용<textarea id="crm361ConfirmNote" rows="7" placeholder="거래 가능 여부, 가격 협의, 입주 가능일, 추가 확인사항 등을 기록하세요."></textarea></label></div></section>
  <section class="crm361-fu-panel hidden" data-panel="history"><div id="crm361PriceHistory"></div></section>`;
  $('#modalSubmit').style.display='';
  $('#modalSubmit').onclick=async e=>{e.preventDefault();const active=$('.crm361-fu-tab.active')?.dataset.tab||'record';
    if(active==='record'){
      const content=$('#crm361FuContent').value.trim();if(!content)return toast('FU 내용을 입력하세요.');
      const history={created_by:state.profile.id,follow_up_date:$('#crm361FuDate').value,contact_method:$('#crm361FuMethod').value,content,next_follow_up_at:$('#crm361FuNext').value||null,listing_id:id};
      const {error}=await state.client.from('interaction_history').insert(history);if(error)return toast(error.message);
      await state.client.from('listings').update({last_follow_up_at:history.follow_up_date}).eq('id',id);await crm385RecalcNextFu(id);
      $('#modal').close();toast('FU 내용과 예정 일정을 히스토리에 저장했습니다.');return state.view==='adminListings'?renderAdminListings():renderMyListings();
    }
    if(active==='confirm'){
      const oldOpts=opts.map(o=>({...o}));const newOpts=[...document.querySelectorAll('.crm385-confirm-deal')].map((row,i)=>({id:row.dataset.id||null,deal_type:row.dataset.type,price:crm385Num(row.querySelector('.crm385-confirm-price').value),monthly_rent:row.dataset.type==='월세'?crm385Num(row.querySelector('.crm385-confirm-rent')?.value):null,is_preferred:oldOpts.find(o=>o.deal_type===row.dataset.type)?.is_preferred||false,sort_order:i}));
      const result=$('#crm361ConfirmResult').value,note=$('#crm361ConfirmNote').value.trim(),next=$('#crm361NextConfirm').value||null;
      const preferred=newOpts.find(o=>o.is_preferred)||newOpts[0];
      const {error}=await state.client.from('listing_confirmation_logs').insert({listing_id:id,confirmed_by:state.profile.id,result,note:note||null,confirmed_price:preferred?.price??null,confirmed_monthly_rent:preferred?.monthly_rent??null,next_confirm_at:next});if(error)return toast(error.message);
      for(const o of newOpts){if(o.id)await state.client.from('listing_deal_options').update({price:o.price,monthly_rent:o.monthly_rent}).eq('id',o.id)}
      const update={last_confirmed_at:today(),next_confirm_at:null};if(preferred){update.transaction_type=preferred.deal_type;update.price=preferred.price;update.monthly_rent=preferred.monthly_rent}if(result==='거래 완료')update.status='complete';else if(result==='협의 중')update.status='hold';else if(result==='거래 가능')update.status='available';
      const {error:uErr}=await state.client.from('listings').update(update).eq('id',id);if(uErr)return toast(uErr.message);
      await state.client.from('interaction_history').insert({created_by:state.profile.id,follow_up_date:today(),contact_method:'매물확인',content:`확인 결과: ${result}${note?`\n${note}`:''}`,listing_id:id,next_follow_up_at:next});
      await crm385RecordDealChanges(id,oldOpts,newOpts);await crm385RecalcNextFu(id);
      $('#modal').close();toast('확인 전화, 가격 이력, FU 히스토리를 함께 저장했습니다.');return state.view==='adminListings'?renderAdminListings():renderMyListings();
    }
  };$('#modal').showModal();
};
openFollowUpModal=function(entityType,id){return entityType==='listing'?crm361OpenListingFu(id):crm361BaseOpenFollowUpModal(entityType,id)};
const crm385BaseDeleteHistoryItem=deleteHistoryItem;
deleteHistoryItem=async function(historyId,entityType,entityId){await crm385BaseDeleteHistoryItem(historyId,entityType,entityId);if(entityType==='listing')await crm385RecalcNextFu(entityId)};
Object.assign(window,{openListingModal,openFollowUpModal,crm361OpenListingFu,deleteHistoryItem});
console.info('CRM v3.8.5 FU 일정·복수 거래 가격이력 통합 로드 완료');

/* ===== CRM v3.8.6 FU 거래유형 전환·전체 거래필터·통합 연락처 ===== */
function crm386ContactRows(contacts=[]){
  return contacts.map((c,i)=>`<div class="crm38-contact-row"><select class="crm38-contact-role"><option ${c.contact_role==='소유주'?'selected':''}>소유주</option><option ${c.contact_role==='임차인'?'selected':''}>임차인</option><option ${c.contact_role==='관리자'?'selected':''}>관리자</option><option ${c.contact_role==='매수인'?'selected':''}>매수인</option><option ${c.contact_role==='기타'?'selected':''}>기타</option></select><input class="crm38-contact-name" placeholder="성명/메모" value="${escapeHtml(c.contact_name||'')}"><input class="crm38-contact-phone" placeholder="010-0000-0000" value="${escapeHtml(crm381FormatPhone(c.phone||''))}"><button type="button" class="danger" onclick="this.closest('.crm38-contact-row').remove()">삭제</button></div>`).join('');
}
crm38ContactRows=crm386ContactRows;
crm38AddContactRow=function(role='소유주'){
  const box=$('#crm38ExtraContacts');
  if(!box)return;
  box.insertAdjacentHTML('beforeend',crm386ContactRows([{contact_role:role}]));
  const row=box.lastElementChild;
  const phone=row?.querySelector('.crm38-contact-phone');
  if(phone)phone.addEventListener('input',()=>crm381PhoneInput(phone));
};

const crm386BaseOpenListingModal=openListingModal;
openListingModal=function(id){
  const item=id?state.listings.find(v=>v.id===id):null;
  let restoredContacts=null;
  if(item){
    restoredContacts=item.additional_contacts;
    const contacts=[...(item.additional_contacts||[])];
    if(item.contact_phone&&!contacts.some(c=>crm381FormatPhone(c.phone)===crm381FormatPhone(item.contact_phone))){
      contacts.unshift({contact_role:'소유주',contact_name:null,phone:item.contact_phone,sort_order:-1});
    }
    item.additional_contacts=contacts;
  }
  crm386BaseOpenListingModal(id);
  if(item)item.additional_contacts=restoredContacts;

  const ownerInput=document.querySelector('#modalBody input[name="contact_phone"]');
  const ownerLabel=ownerInput?.closest('label');
  ownerLabel?.remove();
  const titleLabel=document.querySelector('#modalBody input[name="title"]')?.closest('label');
  titleLabel?.insertAdjacentHTML('afterend',`<div class="crm386-contact-toolbar"><div><strong>연락처</strong><div class="field-help">소유주·임차인·관리자 등 필요한 연락처를 모두 추가하세요.</div></div><button type="button" class="ghost" onclick="crm38AddContactRow('소유주')">+ 번호 추가</button></div>`);
  const contactBox=$('#crm38ExtraContacts');
  contactBox?.classList.add('crm386-contact-box');
  if(contactBox&&!contactBox.children.length){
    contactBox.innerHTML='<div class="field-help crm386-contact-empty">등록된 연락처가 없습니다. ‘+ 번호 추가’를 눌러 등록하세요.</div>';
  }
  if(contactBox){
    const observer=new MutationObserver(()=>{
      const empty=contactBox.querySelector('.crm386-contact-empty');
      if(empty&&contactBox.querySelector('.crm38-contact-row'))empty.remove();
    });
    observer.observe(contactBox,{childList:true});
    $('#modal')?.addEventListener('close',()=>observer.disconnect(),{once:true});
  }
};

function crm386FuDealCard(type,opt={}){
  const checked=!!opt.checked;
  const label=type==='매매'?'매매가':type==='전세'?'전세금':'보증금';
  return `<div class="crm386-fu-deal" data-type="${type}"><div class="crm386-fu-deal-head"><label class="inline-check"><input type="checkbox" class="crm386-fu-deal-check" ${checked?'checked':''} onchange="crm386SyncFuDeals()"> ${type}</label><label class="inline-check"><input type="radio" name="crm386_fu_preferred" ${opt.is_preferred?'checked':''} ${checked?'':'disabled'}> 선호유형</label></div><div class="crm386-fu-deal-fields" ${checked?'':'hidden'}><label>${label}(만원)<input class="crm386-fu-price" type="number" min="0" value="${opt.price??''}"></label>${type==='월세'?`<label>월세(만원)<input class="crm386-fu-rent" type="number" min="0" value="${opt.monthly_rent??''}"></label>`:''}</div></div>`;
}
function crm386SyncFuDeals(){
  const cards=[...document.querySelectorAll('.crm386-fu-deal')];
  cards.forEach(card=>{const on=card.querySelector('.crm386-fu-deal-check').checked;card.querySelector('.crm386-fu-deal-fields').hidden=!on;const radio=card.querySelector('input[type=radio]');radio.disabled=!on;if(!on)radio.checked=false;});
  const active=cards.filter(c=>c.querySelector('.crm386-fu-deal-check').checked);
  if(active.length&&!active.some(c=>c.querySelector('input[type=radio]').checked))active[0].querySelector('input[type=radio]').checked=true;
}
function crm386CollectFuDeals(){
  return [...document.querySelectorAll('.crm386-fu-deal')].filter(card=>card.querySelector('.crm386-fu-deal-check').checked).map((card,i)=>({deal_type:card.dataset.type,price:crm385Num(card.querySelector('.crm386-fu-price').value),monthly_rent:card.dataset.type==='월세'?crm385Num(card.querySelector('.crm386-fu-rent')?.value):null,is_preferred:card.querySelector('input[type=radio]').checked,sort_order:i}));
}

crm361OpenListingFu=async function(id){
  const item=state.listings.find(x=>x.id===id);if(!item)return toast('매물을 찾지 못했습니다.');
  const oldOpts=crm38DealOptions(item).map(o=>({...o}));
  const map=Object.fromEntries(oldOpts.map(o=>[o.deal_type,{...o,checked:true}]));
  $('#modalTitle').textContent=`${item.title} · FU 관리`;
  $('#modalBody').innerHTML=`<input id="crm361ListingId" type="hidden" value="${id}"><div class="crm361-fu-tabs"><button type="button" class="crm361-fu-tab active" data-tab="record" onclick="crm361SetFuTab('record')">FU 기록</button><button type="button" class="crm361-fu-tab" data-tab="confirm" onclick="crm361SetFuTab('confirm')">확인 전화</button><button type="button" class="crm361-fu-tab" data-tab="history" onclick="crm361SetFuTab('history')">가격 이력</button></div>
  <section class="crm361-fu-panel" data-panel="record"><div class="form-grid"><label>기록 일자<input id="crm361FuDate" type="date" value="${today()}" required></label><label>상담 종류<select id="crm361FuMethod"><option>전화</option><option>대면투어</option><option>촬영</option><option>문자/톡 발송</option><option>문자/톡 수신</option><option>부재중</option><option>가계약</option><option>본계약</option><option>중도금</option><option>잔금</option><option>기타</option></select></label><label class="span-2">상담·진행 내용<textarea id="crm361FuContent" rows="7" placeholder="통화 내용, 조건 변경, 다음 조치 등을 구체적으로 기록하세요."></textarea></label><label>예정 FU<input id="crm361FuNext" type="date" value="${item.next_follow_up_at?item.next_follow_up_at.slice(0,10):''}"></label></div></section>
  <section class="crm361-fu-panel hidden" data-panel="confirm"><div class="notice">현재 가능한 거래유형을 체크하세요. 새 유형을 추가하거나 기존 유형을 해제하면 매물 수정 화면, 가격 이력, 일반 히스토리에 모두 반영됩니다.</div><div class="form-grid" style="margin-top:14px"><label>확인 결과<select id="crm361ConfirmResult"><option>거래 가능</option><option>가격 변경</option><option>협의 중</option><option>거래 완료</option><option>연락 안 됨</option><option>재확인 필요</option></select></label><label>예정 FU<input id="crm361NextConfirm" type="date" value="${item.next_follow_up_at?item.next_follow_up_at.slice(0,10):''}"></label><div class="span-2 crm386-fu-deals">${crm386FuDealCard('매매',map['매매']||{})}${crm386FuDealCard('전세',map['전세']||{})}${crm386FuDealCard('월세',map['월세']||{})}</div><label class="span-2">통화 내용<textarea id="crm361ConfirmNote" rows="7" placeholder="거래 가능 여부, 거래유형 추가·종료, 가격 협의, 입주 가능일 등을 기록하세요."></textarea></label></div></section>
  <section class="crm361-fu-panel hidden" data-panel="history"><div id="crm361PriceHistory"></div></section>`;
  crm386SyncFuDeals();
  $('#modalSubmit').style.display='';
  $('#modalSubmit').onclick=async e=>{e.preventDefault();const active=$('.crm361-fu-tab.active')?.dataset.tab||'record';
    if(active==='record'){
      const content=$('#crm361FuContent').value.trim();if(!content)return toast('FU 내용을 입력하세요.');
      const history={created_by:state.profile.id,follow_up_date:$('#crm361FuDate').value,contact_method:$('#crm361FuMethod').value,content,next_follow_up_at:$('#crm361FuNext').value||null,listing_id:id};
      const {error}=await state.client.from('interaction_history').insert(history);if(error)return toast(error.message);
      await state.client.from('listings').update({last_follow_up_at:history.follow_up_date}).eq('id',id);await crm385RecalcNextFu(id);
      $('#modal').close();toast('FU 내용과 예정 일정을 히스토리에 저장했습니다.');return state.view==='adminListings'?renderAdminListings():renderMyListings();
    }
    if(active==='confirm'){
      const newOpts=crm386CollectFuDeals();if(!newOpts.length)return toast('거래유형을 하나 이상 체크하세요.');
      const preferred=newOpts.find(o=>o.is_preferred)||newOpts[0];preferred.is_preferred=true;
      const result=$('#crm361ConfirmResult').value,note=$('#crm361ConfirmNote').value.trim(),next=$('#crm361NextConfirm').value||null;
      const {error:logErr}=await state.client.from('listing_confirmation_logs').insert({listing_id:id,confirmed_by:state.profile.id,result,note:note||null,confirmed_price:preferred.price??null,confirmed_monthly_rent:preferred.monthly_rent??null,next_confirm_at:next});if(logErr)return toast(logErr.message);
      const {error:delErr}=await state.client.from('listing_deal_options').delete().eq('listing_id',id);if(delErr)return toast(delErr.message);
      const {error:insErr}=await state.client.from('listing_deal_options').insert(newOpts.map(o=>({...o,listing_id:id})));if(insErr)return toast(insErr.message);
      const update={last_confirmed_at:today(),next_confirm_at:null,transaction_type:preferred.deal_type,price:preferred.price,monthly_rent:preferred.monthly_rent};
      if(result==='거래 완료')update.status='complete';else if(result==='협의 중')update.status='hold';else if(result==='거래 가능')update.status='available';
      const {error:uErr}=await state.client.from('listings').update(update).eq('id',id);if(uErr)return toast(uErr.message);
      const diff=crm385DiffDealOptions(oldOpts,newOpts);
      const diffText=diff.map(c=>c.kind==='add'?`${c.type} 조건 추가 · ${crm385DealValueText(c.newO)}`:c.kind==='remove'?`${c.type} 조건 종료 · ${crm385DealValueText(c.oldO)}`:`${c.type} 가격 변경 · ${crm385DealValueText(c.oldO)} → ${crm385DealValueText(c.newO)}`).join('\n');
      await state.client.from('interaction_history').insert({created_by:state.profile.id,follow_up_date:today(),contact_method:'매물확인',content:`확인 결과: ${result}${diffText?`\n${diffText}`:''}${note?`\n${note}`:''}`,listing_id:id,next_follow_up_at:next});
      const priceRows=diff.map(c=>({listing_id:id,changed_by:state.profile.id,transaction_type:c.type,old_price:c.oldO?.price??null,new_price:c.newO?.price??null,old_monthly_rent:c.oldO?.monthly_rent??null,new_monthly_rent:c.newO?.monthly_rent??null}));
      if(priceRows.length){const {error:priceErr}=await state.client.from('listing_price_history').insert(priceRows);if(priceErr)toast(`가격 이력 저장 실패: ${priceErr.message}`)}
      await crm385RecalcNextFu(id);await loadListings();
      $('#modal').close();toast('거래유형·가격·FU 히스토리를 모두 반영했습니다.');return state.view==='adminListings'?renderAdminListings():renderMyListings();
    }
  };
  $('#modal').showModal();
};
openFollowUpModal=function(entityType,id){return entityType==='listing'?crm361OpenListingFu(id):crm361BaseOpenFollowUpModal(entityType,id)};

filterNetwork=function(){
  const q=($('#listingSearch')?.value||'').toLowerCase(),tx=$('#listingTx')?.value||'',ty=$('#listingType')?.value||'',st=$('#listingStatus')?.value||'',mx=Number($('#listingMax')?.value||0);
  const rows=state.listings.filter(x=>{
    if(!x.is_public)return false;
    if(q&&!`${x.title} ${x.address} ${x.district} ${x.owner?.full_name} ${x.owner?.office_name}`.toLowerCase().includes(q))return false;
    if(ty&&x.property_type!==ty)return false;if(st&&x.status!==st)return false;
    const opts=crm38DealOptions(x);const matching=tx?opts.filter(o=>o.deal_type===tx):opts;
    if(tx&&!matching.length)return false;
    if(mx&&!matching.some(o=>Number(o.price||0)<=mx))return false;
    return true;
  });
  renderListingTable(rows,'networkTable',false);
};

Object.assign(window,{openListingModal,crm38AddContactRow,crm361OpenListingFu,openFollowUpModal,crm386SyncFuDeals,filterNetwork});
console.info('CRM v3.8.6 FU 거래유형 전환·전체 거래필터·통합 연락처 로드 완료');

/* =========================================================
   CRM v3.8.7 - FU 기록 + 확인전화 통합
   ========================================================= */
function crm387ToggleConfirmBlock(){
  const checked=$('#crm387UseConfirm')?.checked;
  const block=$('#crm387ConfirmBlock');
  if(block) block.hidden=!checked;
  if(checked) crm386SyncFuDeals();
}

crm361OpenListingFu=async function(id){
  const item=state.listings.find(x=>x.id===id);if(!item)return toast('매물을 찾지 못했습니다.');
  const oldOpts=crm38DealOptions(item).map(o=>({...o}));
  const map=Object.fromEntries(oldOpts.map(o=>[o.deal_type,{...o,checked:true}]));
  $('#modalTitle').textContent=`${item.title} · FU 관리`;
  $('#modalBody').innerHTML=`<input id="crm361ListingId" type="hidden" value="${id}">
  <div class="crm361-fu-tabs">
    <button type="button" class="crm361-fu-tab active" data-tab="record" onclick="crm361SetFuTab('record')">FU 기록</button>
    <button type="button" class="crm361-fu-tab" data-tab="history" onclick="crm361SetFuTab('history')">가격 이력</button>
  </div>
  <section class="crm361-fu-panel" data-panel="record">
    <div class="form-grid">
      <label>기록 일자<input id="crm361FuDate" type="date" value="${today()}" required></label>
      <label>상담 종류<select id="crm361FuMethod"><option>전화</option><option>대면투어</option><option>촬영</option><option>문자/톡 발송</option><option>문자/톡 수신</option><option>부재중</option><option>가계약</option><option>본계약</option><option>중도금</option><option>잔금</option><option>기타</option></select></label>
      <label class="span-2">상담·진행 내용<textarea id="crm361FuContent" rows="6" placeholder="통화 내용, 조건 변경, 다음 조치 등을 구체적으로 기록하세요."></textarea></label>
      <label>예정 FU<input id="crm361FuNext" type="date" value="${item.next_follow_up_at?item.next_follow_up_at.slice(0,10):''}"></label>
      
    </div>
    <div class="crm387-confirm-wrap">
      <label class="inline-check crm387-confirm-toggle"><input id="crm387UseConfirm" type="checkbox" onchange="crm387ToggleConfirmBlock()"> 거래조건 변경</label>
      <div id="crm387ConfirmBlock" hidden>
        <div class="notice">확인 결과와 현재 가능한 거래유형을 함께 저장합니다. 거래유형 추가·종료 또는 가격 변경 시 매물 정보, 가격 이력, FU 히스토리에 모두 반영됩니다.</div>
        <div class="form-grid" style="margin-top:14px">
          <label>확인 결과<select id="crm361ConfirmResult"><option>거래 가능</option><option>가격 변경</option><option>협의 중</option><option>거래 완료</option><option>연락 안 됨</option><option>재확인 필요</option></select></label>
          <div></div>
          <div class="span-2 crm386-fu-deals">${crm386FuDealCard('매매',map['매매']||{})}${crm386FuDealCard('전세',map['전세']||{})}${crm386FuDealCard('월세',map['월세']||{})}</div>
        </div>
      </div>
    </div>
  </section>
  <section class="crm361-fu-panel hidden" data-panel="history"><div id="crm361PriceHistory"></div></section>`;
  $('#modalSubmit').style.display='';
  $('#modalSubmit').onclick=async e=>{
    e.preventDefault();
    const active=$('.crm361-fu-tab.active')?.dataset.tab||'record';
    if(active==='history') return;
    const content=$('#crm361FuContent').value.trim();
    const useConfirm=!!$('#crm387UseConfirm')?.checked;
    if(!content&&!useConfirm)return toast('FU 내용 또는 확인 전화 내용을 입력하세요.');
    const fuDate=$('#crm361FuDate').value||today();
    const next=$('#crm361FuNext').value||null;
    let diffText='';
    let result='';
    let confirmNote='';
    if(useConfirm){
      const newOpts=crm386CollectFuDeals();if(!newOpts.length)return toast('거래유형을 하나 이상 체크하세요.');
      const preferred=newOpts.find(o=>o.is_preferred)||newOpts[0];preferred.is_preferred=true;
      result=$('#crm361ConfirmResult').value;
      confirmNote='';
      const {error:logErr}=await state.client.from('listing_confirmation_logs').insert({listing_id:id,confirmed_by:state.profile.id,result,note:confirmNote||null,confirmed_price:preferred.price??null,confirmed_monthly_rent:preferred.monthly_rent??null,next_confirm_at:next});if(logErr)return toast(logErr.message);
      const {error:delErr}=await state.client.from('listing_deal_options').delete().eq('listing_id',id);if(delErr)return toast(delErr.message);
      const {error:insErr}=await state.client.from('listing_deal_options').insert(newOpts.map(o=>({...o,listing_id:id})));if(insErr)return toast(insErr.message);
      const update={last_confirmed_at:fuDate,next_confirm_at:null,transaction_type:preferred.deal_type,price:preferred.price,monthly_rent:preferred.monthly_rent,last_follow_up_at:fuDate};
      if(result==='거래 완료')update.status='complete';else if(result==='협의 중')update.status='hold';else if(result==='거래 가능')update.status='available';
      const {error:uErr}=await state.client.from('listings').update(update).eq('id',id);if(uErr)return toast(uErr.message);
      const diff=crm385DiffDealOptions(oldOpts,newOpts);
      diffText=diff.map(c=>c.kind==='add'?`${c.type} 조건 추가 · ${crm385DealValueText(c.newO)}`:c.kind==='remove'?`${c.type} 조건 종료 · ${crm385DealValueText(c.oldO)}`:`${c.type} 가격 변경 · ${crm385DealValueText(c.oldO)} → ${crm385DealValueText(c.newO)}`).join('\n');
      const priceRows=diff.map(c=>({listing_id:id,changed_by:state.profile.id,transaction_type:c.type,old_price:c.oldO?.price??null,new_price:c.newO?.price??null,old_monthly_rent:c.oldO?.monthly_rent??null,new_monthly_rent:c.newO?.monthly_rent??null}));
      if(priceRows.length){const {error:priceErr}=await state.client.from('listing_price_history').insert(priceRows);if(priceErr)toast(`가격 이력 저장 실패: ${priceErr.message}`)}
    }
    const parts=[];
    if(content)parts.push(content);
    if(useConfirm)parts.push(`확인 결과: ${result}${diffText?`\n${diffText}`:''}${confirmNote?`\n${confirmNote}`:''}`);
    const history={created_by:state.profile.id,follow_up_date:fuDate,contact_method:useConfirm?'매물확인':$('#crm361FuMethod').value,content:parts.join('\n\n'),next_follow_up_at:next,listing_id:id};
    const {error:hErr}=await state.client.from('interaction_history').insert(history);if(hErr)return toast(hErr.message);
    if(!useConfirm)await state.client.from('listings').update({last_follow_up_at:fuDate}).eq('id',id);
    // 입력한 예정 FU를 기존 일정 비교 없이 즉시 반영합니다.
    const {error:nextFuErr}=await state.client.from('listings').update({next_follow_up_at:next}).eq('id',id);
    if(nextFuErr)return toast(`예정 FU 반영 실패: ${nextFuErr.message}`);
    await loadListings();
    $('#modal').close();toast(useConfirm?'FU·확인전화·가격변경을 히스토리에 함께 저장했습니다.':'FU 내용과 예정 일정을 반영했습니다.');
    return state.view==='adminListings'?renderAdminListings():renderMyListings();
  };
  $('#modal').showModal();
};
openFollowUpModal=function(entityType,id){return entityType==='listing'?crm361OpenListingFu(id):crm361BaseOpenFollowUpModal(entityType,id)};
Object.assign(window,{crm361OpenListingFu,openFollowUpModal,crm387ToggleConfirmBlock});
console.info('CRM v3.8.7 FU 기록·확인전화 통합 로드 완료');

/* CRM v3.8.8 - FU 예정일 즉시 반영 버그 수정 */
console.info('CRM v3.8.8 FU 예정일 즉시 반영 로드 완료');

/* ===== CRM v3.8.9 연락처 구분 옆 이름 표시 ===== */
function crm389ContactDisplay(x){
  const contacts=[];
  const seen=new Set();
  const extras=Array.isArray(x.additional_contacts)?x.additional_contacts:[];

  // 기존 소유주 번호가 별도 칼럼에 남아 있는 경우, 동일 번호의 추가 연락처에서 이름을 찾아 함께 표시합니다.
  if(x.contact_phone){
    const phone=crm381FormatPhone(x.contact_phone);
    const matched=extras.find(c=>c.phone&&crm381FormatPhone(c.phone)===phone);
    contacts.push({role:'소유주',name:matched?.contact_name||'',phone});
    seen.add(phone);
  }

  extras.forEach(c=>{
    if(!c.phone)return;
    const phone=crm381FormatPhone(c.phone);
    if(seen.has(phone))return;
    contacts.push({role:c.contact_role||'기타',name:c.contact_name||'',phone});
    seen.add(phone);
  });

  if(!contacts.length)return '-';
  return `<div class="crm384-contact-list">${contacts.map(c=>`<div class="crm384-contact-item"><strong>${escapeHtml(c.role)}${c.name?` <span class="crm389-contact-name">${escapeHtml(c.name)}</span>`:''}</strong><span>${escapeHtml(c.phone)}</span></div>`).join('')}</div>`;
}
crm382ContactDisplay=crm389ContactDisplay;
crm384ContactDisplay=crm389ContactDisplay;
Object.assign(window,{crm382ContactDisplay,crm384ContactDisplay,crm389ContactDisplay});
console.info('CRM v3.8.9 연락처 이름 표시 개선 로드 완료');

/* ===== CRM v3.8.10 통합검색 타인 매물 읽기 전용 ===== */
function crm3810ApplyReadOnlyListing(listing){
  const modal=$('#modal');
  const body=$('#modalBody');
  if(!modal||!body)return;
  $('#modalTitle').textContent=`${listing.title} · 매물 보기 (읽기 전용)`;
  body.querySelectorAll('input, select, textarea, button').forEach(el=>{
    el.disabled=true;
    if(el.tagName==='INPUT'&&['file','checkbox','radio'].includes(el.type)) el.style.pointerEvents='none';
  });
  body.querySelectorAll('[contenteditable="true"]').forEach(el=>el.setAttribute('contenteditable','false'));
  const submit=$('#modalSubmit');
  if(submit){submit.style.display='none';submit.onclick=null;}
  let notice=body.querySelector('.crm3810-readonly-notice');
  if(!notice){
    notice=document.createElement('div');
    notice.className='notice crm3810-readonly-notice';
    notice.textContent='다른 중개사가 등록한 매물입니다. 통합검색에서는 내용을 확인만 할 수 있으며 수정할 수 없습니다.';
    body.prepend(notice);
  }
}
function openGlobalSearchListing(id){
  const listing=state.listings.find(x=>x.id===id);
  if(!listing)return toast('매물을 찾지 못했습니다.');
  if(listing.owner_id===state.profile.id)return openListingModal(id);
  openListingModal(id);
  [60,180,400].forEach(ms=>setTimeout(()=>crm3810ApplyReadOnlyListing(listing),ms));
}
runGlobalSearch=function(){
  const q=normalizeText($('#globalSearchInput').value);
  if(!q){$('#globalSearchResults').innerHTML='<div class="empty">검색어를 입력하세요.</div>';return}
  const customers=state.customers.filter(x=>normalizeText(`${x.name} ${x.phone} ${x.preferred_area} ${x.notes}`).includes(q));
  const listings=state.listings.filter(x=>normalizeText(`${x.title} ${x.address} ${x.district} ${x.contact_phone} ${x.description} ${x.owner?.full_name}`).includes(q));
  $('#globalSearchResults').innerHTML=`<div class="split"><div><h3>고객 ${customers.length}명</h3>${customers.map(x=>`<div class="search-result"><strong>${escapeHtml(x.name)}</strong><span>${escapeHtml(x.phone||'')} · ${escapeHtml(x.preferred_area||'')}</span><button onclick="openCustomerModal('${x.id}')">열기</button></div>`).join('')||'<div class="empty">결과 없음</div>'}</div><div><h3>매물 ${listings.length}개</h3>${listings.map(x=>{const mine=x.owner_id===state.profile.id;return `<div class="search-result"><strong>${escapeHtml(x.title)}</strong><span>${escapeHtml(x.address||'')} · ${listingPriceText(x)}${mine?' · 내 매물':' · 읽기 전용'}</span><button onclick="openGlobalSearchListing('${x.id}')">${mine?'수정':'보기'}</button></div>`}).join('')||'<div class="empty">결과 없음</div>'}</div></div>`;
};
Object.assign(window,{runGlobalSearch,openGlobalSearchListing});
console.info('CRM v3.8.10 통합검색 타인 매물 읽기 전용 로드 완료');

/* CRM v3.8.11 - 예정 FU 직접 반영·거래조건 변경 문구 정리 */
console.info('CRM v3.8.11 예정 FU 직접 반영·거래조건 변경 문구 정리 로드 완료');

/* CRM v3.8.12 - 매물 목록 상세주소 표시 */
console.info('CRM v3.8.12 매물 목록 상세주소 표시 로드 완료');

/* ================= CRM v3.8.13 목록·장기미접촉·계약서 관리 ================= */

moveInText=function(x){
  if(x.move_in_immediate)return '즉시입주';
  if(x.move_in_date&&x.move_in_negotiable)return `${fmtDate(x.move_in_date)}<br><span class="muted">협의 가능</span>`;
  if(x.move_in_date)return fmtDate(x.move_in_date);
  if(x.move_in_negotiable)return '협의 가능';
  return '-';
};

crm37DormantInfo=function(customer){
  const due=customer.next_follow_up_at;
  if(!due)return {days:0,label:'',color:'gray'};
  const d=new Date(`${due}T00:00:00`);
  if(Number.isNaN(d.getTime()))return {days:0,label:'',color:'gray'};
  const days=Math.floor((new Date(`${today()}T00:00:00`)-d)/86400000);
  if(days<7)return {days:Math.max(0,days),label:'',color:'gray'};
  if(days>=30)return {days,label:`FU ${days}일 지연`,color:'red'};
  if(days>=14)return {days,label:`FU ${days}일 지연`,color:'yellow'};
  return {days,label:`FU ${days}일 지연`,color:'gray'};
};

renderListingTable=function(rows,target,mine,adminMode=false){
  const el=$('#'+target);
  const totalCols=(adminMode?1:0)+16+(mine?1:0);
  el.innerHTML=rows.length?`<div class="table-wrap listing-table-wrap"><table class="listing-table crm3813-listing-table"><thead><tr>${adminMode?'<th class="select-col">선택</th>':''}<th>상태</th><th>거래</th><th>유형</th><th>매물명</th><th>지역</th><th>금액</th><th>연락처</th><th>대출</th><th>전용면적</th><th>방/욕실</th><th>입주</th><th>담당</th><th>진행상황</th><th>최종 FU</th><th>예정 FU</th>${mine?'<th>관리</th>':''}</tr></thead><tbody>${rows.map(x=>`<tr class="crm3813-address-row">${adminMode?'<td></td>':''}<td colspan="3"><div title="${escapeHtml(x.address||x.district||'주소 미입력')}">${escapeHtml(x.address||x.district||'주소 미입력')}</div></td><td colspan="${totalCols-(adminMode?1:0)-3}"></td></tr><tr>${adminMode?`<td><input type="checkbox" class="admin-listing-check" value="${x.id}" onchange="toggleAdminListingSelection('${x.id}',this.checked)"></td>`:''}<td>${badge(x.status==='available'?'거래 가능':x.status==='complete'?'거래 완료':'협의 중',x.status==='available'?'green':x.status==='complete'?'gray':'yellow')}</td><td>${escapeHtml(crm38DealTypeText(x))}</td><td>${escapeHtml(x.property_type)}</td><td><button type="button" class="crm3814-listing-title-link" onclick="openListingDetail('${x.id}')" title="매물 상세정보 보기">${escapeHtml(x.title)}</button>${x.is_public?'':' '+badge('비공개','red')}<br><button class="photo-link" onclick="openListingPhotos('${x.id}')">📷 내부사진</button></td><td>${escapeHtml(listingAreaText(x))}</td><td>${listingPriceText(x)}</td><td>${crm382ContactDisplay(x)}</td><td>${x.loan_available===true?badge('O','green'):x.loan_available===false?badge('X','red'):badge('미확인','gray')}</td><td>${x.area_m2?`${x.area_m2}㎡<br><span class="muted">약 ${(Number(x.area_m2)/3.3058).toFixed(2)}평</span>`:'-'}</td><td>${listingRoomText(x)} / ${x.bathroom_count??'-'}</td><td>${moveInText(x)}</td><td>${escapeHtml(x.owner?.full_name||'-')}</td><td>${contractStage(x)}</td><td>${fmtDate(x.last_follow_up_at||x.last_confirmed_at)}</td><td>${dueBadge(x.next_follow_up_at)}</td>${mine?`<td><div class="row-actions"><button class="success" onclick="openFollowUpModal('listing','${x.id}')">FU</button><button class="ghost" onclick="openHistoryModal('listing','${x.id}')">히스토리</button><button class="ghost" onclick="openContractModal('listing','${x.id}')">진행상황</button><button class="ghost" onclick="openListingModal('${x.id}')">수정</button>${adminMode?`<button class="primary" onclick="openSingleListingTransfer('${x.id}')">개별 이관</button>`:''}<button class="danger" onclick="deleteListing('${x.id}')">삭제</button></div></td>`:''}</tr>`).join('')}</tbody></table></div>`:'<div class="empty">조건에 맞는 매물이 없습니다.</div>';
  if(adminMode)updateBulkTransferControls();
};

async function renderDocuments(){
  await loadListings();
  $('#content').innerHTML=`<div class="panel"><div class="panel-head"><div><h3>계약서 관리</h3><div class="muted">계약 기본정보와 계약서 파일만 간단히 등록합니다.</div></div><button class="primary" onclick="openContractDocumentForm()">계약서 등록</button></div><div id="documentList"><div class="empty">계약서를 불러오는 중입니다.</div></div></div>`;
  await loadContractDocuments();
}

function openContractDocumentForm(){
  $('#modalTitle').textContent='계약서 등록';
  $('#modalBody').innerHTML=`<div class="form-grid crm3813-contract-form">
    <label>매물명<input id="cdListingTitle" placeholder="예: 해성 오피스텔"></label>
    <label>주소<input id="cdAddress" placeholder="예: 서울 강서구 화곡동 1039-27 203호"></label>
    <label>거래조건<input id="cdTerms" placeholder="예: 전세 1억7,000만원"></label>
    <label>중개구분<select id="cdBrokerageType"><option value="단타">단타</option><option value="양타">양타</option></select></label>
    <label>계약자 1 이름<input id="cdParty1Name"></label>
    <label>계약자 1 연락처<input id="cdParty1Phone" placeholder="010-0000-0000"></label>
    <label>계약자 2 이름<input id="cdParty2Name"></label>
    <label>계약자 2 연락처<input id="cdParty2Phone" placeholder="010-0000-0000"></label>
    <label>가계약일<input id="cdPrecontractDate" type="date"></label>
    <label>계약일<input id="cdContractDate" type="date"></label>
    <label>잔금일<input id="cdBalanceDate" type="date"></label>
    <label>계약서 파일<input id="cdFile" type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.hwp,.hwpx"></label>
    <label class="span-2">메모<textarea id="cdNotes" rows="3" placeholder="특약이나 확인할 내용을 간단히 적으세요."></textarea></label>
  </div>`;
  ['cdParty1Phone','cdParty2Phone'].forEach(id=>{const e=$('#'+id);e?.addEventListener('input',()=>e.value=formatPhone(e.value))});
  $('#modalSubmit').style.display='';
  $('#modalSubmit').textContent='등록';
  $('#modalSubmit').onclick=saveContractDocument;
  $('#modal').showModal();
}

async function saveContractDocument(e){
  e?.preventDefault();
  const file=$('#cdFile').files[0];
  if(!$('#cdListingTitle').value.trim()||!$('#cdAddress').value.trim())return toast('매물명과 주소를 입력하세요.');
  if(!file)return toast('계약서 파일을 선택하세요.');
  if(file.size>20*1024*1024)return toast('파일은 20MB 이하만 등록할 수 있습니다.');
  const path=`contracts/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;
  const {error:u}=await state.client.storage.from('contract-documents').upload(path,file);
  if(u)return toast(u.message);
  const row={
    document_type:'계약서',file_name:file.name,storage_path:path,uploaded_by:state.profile.id,
    listing_title:$('#cdListingTitle').value.trim(),contract_address:$('#cdAddress').value.trim(),deal_terms:$('#cdTerms').value.trim()||null,
    brokerage_type:$('#cdBrokerageType').value,party1_name:$('#cdParty1Name').value.trim()||null,party1_phone:formatPhone($('#cdParty1Phone').value)||null,
    party2_name:$('#cdParty2Name').value.trim()||null,party2_phone:formatPhone($('#cdParty2Phone').value)||null,
    precontract_date:$('#cdPrecontractDate').value||null,contract_date:$('#cdContractDate').value||null,balance_date:$('#cdBalanceDate').value||null,contract_notes:$('#cdNotes').value.trim()||null
  };
  const {error}=await state.client.from('contract_documents').insert(row);
  if(error){await state.client.storage.from('contract-documents').remove([path]);return toast(error.message)}
  $('#modal').close();toast('계약서를 등록했습니다.');await loadContractDocuments();
}

async function loadContractDocuments(){
  const {data,error}=await state.client.from('contract_documents').select('*').order('created_at',{ascending:false});
  if(error)return toast(error.message);
  const rows=data||[];
  $('#documentList').innerHTML=rows.length?`<div class="table-wrap"><table class="crm3813-contract-table"><thead><tr><th>주소</th><th>매물명</th><th>거래조건</th><th>진행상황</th><th>계약일</th><th>잔금일</th><th>관리</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${escapeHtml(x.contract_address||'-')}</td><td><strong>${escapeHtml(x.listing_title||x.file_name||'-')}</strong></td><td>${escapeHtml(x.deal_terms||'-')}</td><td>${badge('계약서 있음','green')}<br><span class="muted">${escapeHtml(x.brokerage_type||'-')}</span></td><td>${fmtDate(x.contract_date)}</td><td>${fmtDate(x.balance_date)}</td><td><div class="row-actions"><button onclick="downloadContractDocument('${x.storage_path}','${escapeHtml(x.file_name)}')">다운로드</button><button class="danger" onclick="deleteContractDocument('${x.id}','${x.storage_path}')">삭제</button></div></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">등록된 계약서가 없습니다.</div>';
}

console.info('CRM v3.8.13 목록·장기미접촉·계약서 관리 로드 완료');


/* CRM v3.8.14 - 매물명 클릭 상세보기 및 타인 매물 읽기 전용 */
function openListingDetail(id){
  const listing=state.listings.find(x=>x.id===id);
  if(!listing)return toast('매물을 찾지 못했습니다.');
  const isMine=listing.owner_id===state.profile.id;
  if(isMine){
    openListingModal(id);
    return;
  }
  openListingModal(id);
  [60,180,400].forEach(ms=>setTimeout(()=>crm3810ApplyReadOnlyListing(listing),ms));
}
Object.assign(window,{openListingDetail});
console.info('CRM v3.8.14 매물명 상세보기·타인 매물 읽기 전용 로드 완료');

/* CRM v3.8.15 - 타인 매물 비밀메모 숨김 */
function crm3815HideOtherListingSecretMemo(){
  const body=$('#modalBody');
  if(!body)return;
  const description=body.querySelector('textarea[name="description"]');
  if(!description)return;
  const field=description.closest('label') || description.parentElement;
  if(field) field.style.display='none';
}
const crm3815BaseApplyReadOnlyListing=crm3810ApplyReadOnlyListing;
crm3810ApplyReadOnlyListing=function(listing){
  crm3815BaseApplyReadOnlyListing(listing);
  crm3815HideOtherListingSecretMemo();
};
runGlobalSearch=function(){
  const q=normalizeText($('#globalSearchInput').value);
  if(!q){$('#globalSearchResults').innerHTML='<div class="empty">검색어를 입력하세요.</div>';return}
  const customers=state.customers.filter(x=>normalizeText(`${x.name} ${x.phone} ${x.preferred_area} ${x.notes}`).includes(q));
  // 다른 중개사의 비밀메모는 통합검색 대상에서도 제외합니다.
  const listings=state.listings.filter(x=>{
    const ownSecret=x.owner_id===state.profile.id ? ` ${x.description||''}` : '';
    return normalizeText(`${x.title} ${x.address} ${x.district} ${x.contact_phone} ${x.owner?.full_name}${ownSecret}`).includes(q);
  });
  $('#globalSearchResults').innerHTML=`<div class="split"><div><h3>고객 ${customers.length}명</h3>${customers.map(x=>`<div class="search-result"><strong>${escapeHtml(x.name)}</strong><span>${escapeHtml(x.phone||'')} · ${escapeHtml(x.preferred_area||'')}</span><button onclick="openCustomerModal('${x.id}')">열기</button></div>`).join('')||'<div class="empty">결과 없음</div>'}</div><div><h3>매물 ${listings.length}개</h3>${listings.map(x=>{const mine=x.owner_id===state.profile.id;return `<div class="search-result"><strong>${escapeHtml(x.title)}</strong><span>${escapeHtml(x.address||'')} · ${listingPriceText(x)}${mine?' · 내 매물':' · 읽기 전용'}</span><button onclick="openGlobalSearchListing('${x.id}')">${mine?'수정':'보기'}</button></div>`}).join('')||'<div class="empty">결과 없음</div>'}</div></div>`;
};
Object.assign(window,{crm3810ApplyReadOnlyListing,runGlobalSearch});
console.info('CRM v3.8.15 타인 매물 비밀메모 숨김 로드 완료');

console.info('CRM v3.8.17 매물 목록 주소 상단 표시 복원 완료');

/* CRM v3.8.18 - 지역 입력 간소화 및 띄어쓰기 무관 검색 */
function crm3818FormatDistrict(value){
  let text=String(value||'').trim().replace(/\s+/g,' ');
  // 지역 칸에는 시·도 대신 구와 동 중심으로 저장합니다.
  text=text.replace(/^(서울특별시|서울시|서울)\s*/,'');
  // 붙여 쓴 구/군 + 동/읍/면을 보기 좋게 자동 분리합니다.
  text=text
    .replace(/([가-힣0-9·-]+(?:구|군))\s*([가-힣0-9·-]+(?:동|읍|면|가))(?=\s|$)/g,'$1 $2')
    .replace(/([가-힣0-9·-]+(?:구|군))(?=[가-힣])/g,'$1 ')
    .replace(/\s+/g,' ')
    .trim();
  return text;
}
function crm3818CompactSearch(value){
  return normalizeText(String(value||'')).replace(/\s+/g,'');
}
function crm3818BindDistrictInput(){
  const input=$('#modalBody input[name="district"]');
  if(!input)return;
  input.placeholder='예: 강서구 화곡동';
  const format=()=>{
    const formatted=crm3818FormatDistrict(input.value);
    if(input.value!==formatted)input.value=formatted;
  };
  input.addEventListener('input',format);
  input.addEventListener('blur',format);
  format();
}
const crm3818BaseOpenListingModal=openListingModal;
openListingModal=function(id){
  const result=crm3818BaseOpenListingModal(id);
  [0,50,150].forEach(ms=>setTimeout(crm3818BindDistrictInput,ms));
  return result;
};
filterNetwork=function(){
  const q=crm3818CompactSearch($('#listingSearch')?.value||''),tx=$('#listingTx')?.value||'',ty=$('#listingType')?.value||'',st=$('#listingStatus')?.value||'',mx=Number($('#listingMax')?.value||0);
  const rows=state.listings.filter(x=>{
    if(!x.is_public)return false;
    const hay=crm3818CompactSearch(`${x.title} ${x.address} ${x.district} ${x.owner?.full_name} ${x.owner?.office_name}`);
    if(q&&!hay.includes(q))return false;
    if(ty&&x.property_type!==ty)return false;
    if(st&&x.status!==st)return false;
    const opts=crm38DealOptions(x),matching=tx?opts.filter(o=>o.deal_type===tx):opts;
    if(tx&&!matching.length)return false;
    if(mx&&!matching.some(o=>Number(o.price||0)<=mx))return false;
    return true;
  });
  renderListingTable(rows,'networkTable',false);
};
filterAdminListings=function(){
  const q=crm3818CompactSearch($('#adminListingSearch')?.value||''),owner=$('#adminListingOwner')?.value||'',visibility=$('#adminListingVisibility')?.value||'',status=$('#adminListingStatus')?.value||'';
  const rows=state.listings.filter(x=>{
    const hay=crm3818CompactSearch(`${x.title} ${x.address} ${x.district} ${x.owner?.full_name} ${x.owner?.office_name} ${x.contact_phone||''}`);
    return (!q||hay.includes(q))&&(!owner||x.owner_id===owner)&&(!status||x.status===status)&&(!visibility||(visibility==='public'?x.is_public:!x.is_public));
  });
  renderListingTable(rows,'adminListingTable',true,true);
};
Object.assign(window,{openListingModal,filterNetwork,filterAdminListings,crm3818FormatDistrict});
console.info('CRM v3.8.18 지역 입력 간소화·띄어쓰기 무관 검색 로드 완료');

/* CRM v3.8.19 - 지역은 입력 중 건드리지 않고 저장 시에만 정리 */
crm3818FormatDistrict=function(value){
  let text=String(value||'').trim();
  text=text.replace(/^(서울특별시|서울시|서울)\s*/,'');
  const compact=text.replace(/\s+/g,'');
  const match=compact.match(/^(.+?(?:구|군))(.+?(?:동|읍|면|가))$/);
  if(match)return `${match[1]} ${match[2]}`;
  return text.replace(/\s+/g,' ').trim();
};
crm3818BindDistrictInput=function(){
  const input=$('#modalBody input[name="district"]');
  if(!input)return;
  input.placeholder='예: 강서구 화곡동';
  // 입력 중에는 값을 절대 변경하지 않습니다.
};
if(!window.__crm3819DistrictSaveBound){
  window.__crm3819DistrictSaveBound=true;
  document.addEventListener('submit',event=>{
    const form=event.target;
    if(form?.id!=='modalForm')return;
    const input=form.querySelector('input[name="district"]');
    if(input)input.value=crm3818FormatDistrict(input.value);
  },true);
}
Object.assign(window,{crm3818FormatDistrict,crm3818BindDistrictInput});
console.info('CRM v3.8.19 지역 저장 시 자동 정리 로드 완료');

/* CRM v3.8.20 - 목록 지역 표시는 지역 입력값만 사용 */
listingAreaText=function(x){
  const district=String(x?.district||'').replace(/\s+/g,' ').trim();
  return district||'-';
};
Object.assign(window,{listingAreaText});
console.info('CRM v3.8.20 목록 지역은 지역 필드 기준으로 표시');

/* CRM v3.8.21 - 지역 입력은 순수 텍스트, 검색은 띄어쓰기 무관 */
crm3818FormatDistrict=function(value){
  // 사용자가 입력한 지역 문구는 임의로 띄어쓰거나 바꾸지 않습니다.
  // 저장 시에는 앞뒤 공백만 정리하고, 검색 단계에서 공백을 무시합니다.
  return String(value||'').trim();
};
crm3818BindDistrictInput=function(){
  const input=$('#modalBody input[name="district"]');
  if(!input)return;
  input.placeholder='예: 강서구 화곡동';
  // input/blur 이벤트로 값을 수정하지 않습니다.
};
function crm3821RegionSearchKey(value){
  return normalizeText(String(value||''))
    .replace(/서울특별시|서울시|서울/g,'')
    .replace(/\s+/g,'');
}
filterNetwork=function(){
  const q=crm3821RegionSearchKey($('#listingSearch')?.value||''),tx=$('#listingTx')?.value||'',ty=$('#listingType')?.value||'',st=$('#listingStatus')?.value||'',mx=Number($('#listingMax')?.value||0);
  const rows=state.listings.filter(x=>{
    if(!x.is_public)return false;
    const hay=crm3821RegionSearchKey(`${x.title} ${x.address} ${x.district} ${x.owner?.full_name} ${x.owner?.office_name}`);
    if(q&&!hay.includes(q))return false;
    if(ty&&x.property_type!==ty)return false;
    if(st&&x.status!==st)return false;
    const opts=crm38DealOptions(x),matching=tx?opts.filter(o=>o.deal_type===tx):opts;
    if(tx&&!matching.length)return false;
    if(mx&&!matching.some(o=>Number(o.price||0)<=mx))return false;
    return true;
  });
  renderListingTable(rows,'networkTable',false);
};
filterAdminListings=function(){
  const q=crm3821RegionSearchKey($('#adminListingSearch')?.value||''),owner=$('#adminListingOwner')?.value||'',visibility=$('#adminListingVisibility')?.value||'',status=$('#adminListingStatus')?.value||'';
  const rows=state.listings.filter(x=>{
    const hay=crm3821RegionSearchKey(`${x.title} ${x.address} ${x.district} ${x.owner?.full_name} ${x.owner?.office_name} ${x.contact_phone||''}`);
    return (!q||hay.includes(q))&&(!owner||x.owner_id===owner)&&(!status||x.status===status)&&(!visibility||(visibility==='public'?x.is_public:!x.is_public));
  });
  renderListingTable(rows,'adminListingTable',true,true);
};
Object.assign(window,{crm3818FormatDistrict,crm3818BindDistrictInput,crm3821RegionSearchKey,filterNetwork,filterAdminListings});
console.info('CRM v3.8.21 지역 순수 텍스트 입력·공백 무관 검색 로드 완료');

/* CRM v3.8.22 - 지역은 입력 그대로 두고 저장 순간에만 구/동 띄어쓰기 정리 */
crm3818FormatDistrict=function(value){
  let text=String(value||'').trim();
  if(!text)return '';

  // 지역 칸에서는 서울 표기를 생략합니다.
  text=text.replace(/^(서울특별시|서울시|서울)\s*/,'');

  // 입력 중에는 건드리지 않고, 저장 직전에만 공백을 제거한 뒤
  // '○○구/군 + ○○동/읍/면/가' 형태로 한 칸 띄워 저장합니다.
  const compact=text.replace(/\s+/g,'');
  const match=compact.match(/^(.+?(?:구|군))(.+?(?:동|읍|면|가))$/);
  if(match)return `${match[1]} ${match[2]}`;

  // 인식되지 않는 자유입력은 내용은 보존하고 중복 공백만 정리합니다.
  return text.replace(/\s+/g,' ').trim();
};
crm3818BindDistrictInput=function(){
  const input=$('#modalBody input[name="district"]');
  if(!input)return;
  input.placeholder='예: 강서구 화곡동';
  // 입력 중 자동변환 없음. modalForm submit 캡처 단계에서만 정리됩니다.
};
Object.assign(window,{crm3818FormatDistrict,crm3818BindDistrictInput});
console.info('CRM v3.8.22 지역 저장 시 구·동 띄어쓰기 정리 로드 완료');


// ===== CRM v3.8.23 진행상황/계약 일정 분리 =====
function contractStage(x){
  const stages=[
    ['잔금',!!x.final_payment_completed],
    ['중도금',!x.interim_payment_not_applicable&&!!x.interim_payment_completed],
    ['본계약',!!x.contract_completed],
    ['가계약',!!x.provisional_contract_completed]
  ];
  const hit=stages.find(v=>v[1]);
  return hit?badge(hit[0],'blue'):'-';
}

function crm3823Money(v){
  return v===null||v===undefined||v===''?'-':`${Number(v).toLocaleString('ko-KR')}만원`;
}
function crm3823StageLine(label, completed, date, amountLabel, amount){
  const status=completed?'완료':'예정';
  return `${label} ${status} · 일정 ${date?fmtDate(date):'미정'} · ${amountLabel} ${crm3823Money(amount)}`;
}
function crm3823ContractSnapshot(x, entityType){
  const lines=[];
  const detail=contractDetailText(x,entityType);
  if(detail) lines.push(detail);
  const latest=contractStage(x).replace(/<[^>]+>/g,'')||'-';
  lines.push(`현재 진행상황: ${latest==='-'?'미진행':latest}`);
  lines.push(crm3823StageLine('가계약',!!x.provisional_contract_completed,x.provisional_contract_date,'가계약금',x.provisional_contract_amount));
  lines.push(crm3823StageLine('본계약',!!x.contract_completed,x.contract_date,'계약금',x.contract_amount));
  if(!x.interim_payment_not_applicable){
    lines.push(crm3823StageLine('중도금',!!x.interim_payment_completed,x.interim_payment_date,'중도금',x.interim_payment_amount));
  }
  lines.push(crm3823StageLine('잔금',!!x.final_payment_completed,x.final_payment_date,'잔금',x.final_payment_amount));
  return lines.join('\n');
}


function crm3859ContractHistory(before, after, entityType){
  const changes=[];
  [['가계약','provisional_contract_completed'],['본계약','contract_completed'],['중도금','interim_payment_completed'],['잔금','final_payment_completed']].forEach(([label,key])=>{
    const was=!!before?.[key], now=!!after?.[key];
    if(was&&!now) changes.push(`${label} 완료 취소됨`);
    else if(!was&&now) changes.push(`${label} 완료`);
  });
  if(!!before?.interim_payment_not_applicable!==!!after?.interim_payment_not_applicable){
    changes.push(after?.interim_payment_not_applicable?'중도금 해당없음으로 변경':'중도금 일정 사용으로 변경');
  }
  const snapshot=crm3823ContractSnapshot(after,entityType);
  return changes.length?`${changes.join('\n')}\n\n${snapshot}`:snapshot;
}

openContractModal=async function(entityType,id){
  const item=entityType==='customer'?state.customers.find(x=>x.id===id):state.listings.find(x=>x.id===id);
  if(!item)return toast('대상을 찾지 못했습니다.');
  $('#modalTitle').textContent=`${entityType==='customer'?item.name:item.title} · 진행상황`;
  const steps=[
    ['provisional_contract_date','가계약','provisional_contract_amount','가계약금','provisional_contract_completed'],
    ['contract_date','본계약','contract_amount','계약금','contract_completed'],
    ['interim_payment_date','중도금','interim_payment_amount','중도금','interim_payment_completed'],
    ['final_payment_date','잔금','final_payment_amount','잔금','final_payment_completed']
  ];
  const demandSide=entityType==='customer'&&['매수','임차'].includes(item.customer_type);
  const defaultProperty=entityType==='listing'?item.title:(item.contracted_property_name||'');
  const defaultType=entityType==='listing'?item.transaction_type:(item.contracted_transaction_type||'');
  const defaultAmount=entityType==='listing'?(item.contracted_amount??item.price??''):(item.contracted_amount??'');
  const defaultMonthlyRent=entityType==='listing'?(item.contracted_monthly_rent??item.monthly_rent??''):(item.contracted_monthly_rent??'');
  const detailFields=demandSide?`
    <div class="contract-detail-grid">
      <label>계약 매물명<input name="contracted_property_name" value="${escapeHtml(defaultProperty)}" placeholder="예: 철산자이 101동 1203호"></label>
      <label>거래유형<select name="contracted_transaction_type"><option value="">선택</option><option>매매</option><option>전세</option><option>월세</option></select></label>
      <label id="contractAmountLabel">거래금액/보증금(만원)<input name="contracted_amount" type="number" value="${defaultAmount}"></label>
      <label id="contractMonthlyRentWrap">월세(만원)<input name="contracted_monthly_rent" type="number" min="0" value="${defaultMonthlyRent}"></label>
      <label>상대방 연락처<input name="counterparty_phone" value="${escapeHtml(item.counterparty_phone||'')}" placeholder="010-0000-0000"></label>
    </div>`:`
    <div class="contract-detail-grid">
      ${entityType==='listing'?`<label>계약 매물명<input name="contracted_property_name" value="${escapeHtml(defaultProperty)}"></label><label>거래유형<select name="contracted_transaction_type"><option value="">선택</option><option>매매</option><option>전세</option><option>월세</option></select></label>`:''}
      <label id="contractAmountLabel">거래금액/보증금(만원)<input name="contracted_amount" type="number" value="${defaultAmount}"></label>
      <label id="contractMonthlyRentWrap">월세(만원)<input name="contracted_monthly_rent" type="number" min="0" value="${defaultMonthlyRent}"></label>
      <label>거래 고객명<input name="counterparty_name" value="${escapeHtml(item.counterparty_name||'')}" placeholder="매수인 또는 임차인 이름"></label>
      <label>거래 고객 연락처<input name="counterparty_phone" value="${escapeHtml(item.counterparty_phone||'')}" placeholder="010-0000-0000"></label>
    </div>`;
  $('#modalBody').innerHTML=`<div class="contract-editor">
    <p class="muted">체크박스는 해당 단계를 실제로 완료했을 때만 체크하세요. 날짜와 금액은 체크하지 않아도 미리 입력할 수 있습니다.</p>
    <section class="contract-detail-box"><h4>계약 정보</h4>${detailFields}</section>
    ${steps.map(([key,label,amountKey,amountLabel,completedKey],i)=>{
      const isInterim=key==='interim_payment_date',na=isInterim&&!!item.interim_payment_not_applicable;
      return `<div class="contract-edit-row ${na?'not-applicable':''}" data-contract-row="${key}">
        <div class="step-no">${i+1}</div>
        <label class="check-label"><input type="checkbox" name="${completedKey}" ${item[completedKey]?'checked':''} ${na?'disabled':''}> ${label} 완료</label>
        <input type="date" name="${key}" value="${item[key]||''}" ${na?'disabled':''}>
        <label class="stage-amount-label">${amountLabel}(만원)<input type="number" min="0" step="1" name="${amountKey}" value="${item[amountKey]??''}" ${na?'disabled':''} placeholder="금액"></label>
        ${isInterim?`<label class="na-label"><input type="checkbox" id="interimNotApplicable" ${na?'checked':''}> 해당없음</label>`:''}
      </div>`
    }).join('')}
  </div>`;
  const typeSelect=$('#modalBody [name=contracted_transaction_type]');
  if(typeSelect)typeSelect.value=defaultType||'';
  const contractMonthlyWrap=$('#contractMonthlyRentWrap'),contractAmountLabel=$('#contractAmountLabel');
  const syncContractMonthly=()=>{
    const isMonthly=typeSelect?.value==='월세';
    if(contractMonthlyWrap){contractMonthlyWrap.style.display=isMonthly?'':'none';if(!isMonthly)contractMonthlyWrap.querySelector('input').value=''}
    if(contractAmountLabel)contractAmountLabel.firstChild.textContent=isMonthly?'보증금(만원)':'거래금액(만원)';
  };
  if(typeSelect)typeSelect.onchange=syncContractMonthly;syncContractMonthly();
  const syncInterim=()=>{
    const na=$('#interimNotApplicable')?.checked||false;
    const row=$('[data-contract-row="interim_payment_date"]');
    row?.classList.toggle('not-applicable',na);
    ['interim_payment_date','interim_payment_amount','interim_payment_completed'].forEach(name=>{
      const el=$(`#modalBody [name=${name}]`);if(!el)return;
      el.disabled=na;
      if(na){if(el.type==='checkbox')el.checked=false;else el.value=''}
    });
  };
  if($('#interimNotApplicable'))$('#interimNotApplicable').onchange=syncInterim;
  syncInterim();
  $('#modalSubmit').onclick=async(e)=>{
    e.preventDefault();
    const fd=new FormData($('#modalForm')),payload={};
    steps.forEach(([key,,, ,completedKey])=>{
      const step=steps.find(s=>s[0]===key);const amountKey=step[2];
      payload[key]=fd.get(key)||null;
      payload[amountKey]=fd.get(amountKey)?Number(fd.get(amountKey)):null;
      payload[completedKey]=fd.get(completedKey)==='on';
    });
    payload.interim_payment_not_applicable=$('#interimNotApplicable')?.checked||false;
    if(payload.interim_payment_not_applicable){
      payload.interim_payment_date=null;payload.interim_payment_amount=null;payload.interim_payment_completed=false;
    }
    payload.contracted_property_name=fd.get('contracted_property_name')||null;
    payload.contracted_transaction_type=fd.get('contracted_transaction_type')||null;
    payload.contracted_amount=fd.get('contracted_amount')?Number(fd.get('contracted_amount')):null;
    payload.contracted_monthly_rent=payload.contracted_transaction_type==='월세'&&fd.get('contracted_monthly_rent')?Number(fd.get('contracted_monthly_rent')):null;
    payload.counterparty_name=fd.get('counterparty_name')||null;
    payload.counterparty_phone=fd.get('counterparty_phone')||null;
    payload.last_follow_up_at=today();
    // 매물 진행상황이 하나라도 완료되면 상태를 거래 완료로 자동 전환한다.
    // 모든 완료 체크가 해제되면 다시 거래 가능으로 전환한다.
    const hasProgress=!!(
      payload.provisional_contract_completed ||
      payload.contract_completed ||
      (!payload.interim_payment_not_applicable && payload.interim_payment_completed) ||
      payload.final_payment_completed
    );
    if(entityType==='listing'){
      payload.status=hasProgress?'complete':'available';
    }else if(entityType==='customer'){
      if(hasProgress) payload.status='계약';
      else if(item.status==='계약') payload.status='매물추천';
    }
    const table=entityType==='customer'?'customers':'listings';
    const {error}=await state.client.from(table).update(payload).eq('id',id);
    if(error)return toast(error.message);
    const tracked=[...steps.flatMap(([key,,amountKey,,completedKey])=>[key,amountKey,completedKey]),'interim_payment_not_applicable','contracted_property_name','contracted_transaction_type','contracted_amount','contracted_monthly_rent','counterparty_name','counterparty_phone'];
    const changed=tracked.some(k=>String(item[k]??'')!==String(payload[k]??''));
    if(changed){
      const updated={...item,...payload};
      const target={customer_id:entityType==='customer'?id:null,listing_id:entityType==='listing'?id:null};
      const {error:hErr}=await state.client.from('interaction_history').insert({
        ...target,created_by:state.profile.id,follow_up_date:today(),contact_method:'진행상황',
        content:crm3859ContractHistory(item,updated,entityType),next_follow_up_at:null
      });
      if(hErr)return toast(`진행상황은 저장됐지만 히스토리 기록에 실패했습니다: ${hErr.message}`);
    }
    // 예정 FU는 절대 변경하지 않는다.
    if(entityType==='customer') await loadCustomers(); else await loadListings();
    $('#modal').close();toast('진행상황을 저장하고 최종 FU를 오늘 날짜로 갱신했습니다.');
    entityType==='customer'?renderCustomers():(state.view==='adminListings'?renderAdminListings():renderMyListings());
  };
  // 계약 취소 버튼: 기존 히스토리는 유지하고 현재 계약 입력값만 초기화한다.
  const modalActions=$('#modalForm .modal-actions');
  const oldCancel=$('#contractCancelBtn');
  if(oldCancel) oldCancel.remove();
  const contractCancelBtn=document.createElement('button');
  contractCancelBtn.type='button';
  contractCancelBtn.id='contractCancelBtn';
  contractCancelBtn.className='danger crm3828-contract-cancel';
  contractCancelBtn.textContent='계약 취소';
  modalActions.prepend(contractCancelBtn);
  contractCancelBtn.onclick=async()=>{
    if(!confirm('현재 계약 진행정보를 모두 초기화하고 계약 파기 이력을 남길까요?')) return;
    const resetPayload={
      provisional_contract_date:null,
      provisional_contract_amount:null,
      provisional_contract_completed:false,
      contract_date:null,
      contract_amount:null,
      contract_completed:false,
      interim_payment_date:null,
      interim_payment_amount:null,
      interim_payment_completed:false,
      interim_payment_not_applicable:false,
      final_payment_date:null,
      final_payment_amount:null,
      final_payment_completed:false,
      contracted_property_name:null,
      contracted_transaction_type:null,
      contracted_amount:null,
      contracted_monthly_rent:null,
      counterparty_name:null,
      counterparty_phone:null,
      last_follow_up_at:today()
    };
    if(entityType==='listing') resetPayload.status='available';
    const table=entityType==='customer'?'customers':'listings';
    const {error}=await state.client.from(table).update(resetPayload).eq('id',id);
    if(error) return toast(error.message);
    const target={customer_id:entityType==='customer'?id:null,listing_id:entityType==='listing'?id:null};
    const previousStage=(contractStage(item).replace(/<[^>]+>/g,'').trim()||'미진행');
    const {error:hErr}=await state.client.from('interaction_history').insert({
      ...target,
      created_by:state.profile.id,
      follow_up_date:today(),
      contact_method:'계약 취소',
      content:`계약 파기됨\n이전 진행상황: ${previousStage}`,
      next_follow_up_at:null
    });
    if(hErr) return toast(`계약정보는 초기화됐지만 히스토리 기록에 실패했습니다: ${hErr.message}`);
    if(entityType==='customer') await loadCustomers(); else await loadListings();
    $('#modal').close();
    toast('계약정보를 초기화하고 계약 파기 이력을 남겼습니다.');
    entityType==='customer'?renderCustomers():(state.view==='adminListings'?renderAdminListings():renderMyListings());
  };
  $('#modal').showModal();
};

// ===== CRM v3.8.28 계약 취소 및 계약정보 초기화 =====
console.info('CRM v3.8.28 계약 취소 기능 적용 완료');

// ===== CRM v3.8.24 순번·매물 집계·고객 진행상황 =====
function crm3824PreferredDealType(listing){
  const options=crm38DealOptions(listing)||[];
  const preferred=options.find(o=>o.is_preferred);
  return preferred?.deal_type || options[0]?.deal_type || listing?.transaction_type || '';
}
function crm3824ListingSummary(rows){
  const counts={전체:rows.length,매매:0,전세:0,월세:0};
  rows.forEach(x=>{const type=crm3824PreferredDealType(x);if(Object.prototype.hasOwnProperty.call(counts,type))counts[type]++});
  return `<div class="crm3824-listing-summary" aria-label="매물 현황">
    <div><span>전체 매물</span><strong>${counts.전체}</strong></div>
    <div><span>매매</span><strong>${counts.매매}</strong></div>
    <div><span>전세</span><strong>${counts.전세}</strong></div>
    <div><span>월세</span><strong>${counts.월세}</strong></div>
  </div>`;
}

renderMyListings=async function(){
  await loadListings();
  state.myListings=state.listings.filter(x=>x.owner_id===state.profile.id);
  $('#topActions').innerHTML='<button class="primary" onclick="openListingModal()">+ 매물 등록</button>';
  $('#content').innerHTML=`<div class="notice crm3824-my-listing-head" style="margin-bottom:14px">
    <div>이 시트에서 등록한 매물은 공개 상태가 ‘공개’인 경우 공동매물망에 자동으로 올라갑니다.</div>
    ${crm3824ListingSummary(state.myListings)}
  </div><div class="panel"><div id="myListingTable"></div></div>`;
  renderListingTable(state.myListings,'myListingTable',true);
  crm37AddQuickActions();
};

renderListingTable=function(rows,target,mine,adminMode=false){
  const el=$('#'+target);
  const totalCols=1+(adminMode?1:0)+16+(mine?1:0);
  el.innerHTML=rows.length?`<div class="table-wrap listing-table-wrap"><table class="listing-table crm3813-listing-table crm3824-numbered-table"><thead><tr><th class="crm3824-no-col">순번</th>${adminMode?'<th class="select-col">선택</th>':''}<th>상태</th><th>거래</th><th>유형</th><th>매물명</th><th>지역</th><th>금액</th><th>연락처</th><th>대출</th><th>전용면적</th><th>방/욕실</th><th>입주</th><th>담당</th><th>진행상황</th><th>최종 FU</th><th>예정 FU</th>${mine?'<th>관리</th>':''}</tr></thead><tbody>${rows.map((x,index)=>`<tr class="crm3813-address-row"><td class="crm3824-address-no">${index+1}</td>${adminMode?'<td></td>':''}<td colspan="3"><div title="${escapeHtml(x.address||x.district||'주소 미입력')}">${escapeHtml(x.address||x.district||'주소 미입력')}</div></td><td colspan="${totalCols-1-(adminMode?1:0)-3}"></td></tr><tr><td class="crm3824-no-cell">${index+1}</td>${adminMode?`<td><input type="checkbox" class="admin-listing-check" value="${x.id}" onchange="toggleAdminListingSelection('${x.id}',this.checked)"></td>`:''}<td>${badge(x.status==='available'?'거래 가능':x.status==='complete'?'거래 완료':'협의 중',x.status==='available'?'green':x.status==='complete'?'gray':'yellow')}</td><td>${escapeHtml(crm38DealTypeText(x))}</td><td>${escapeHtml(x.property_type)}</td><td><button type="button" class="crm3814-listing-title-link" onclick="openListingDetail('${x.id}')" title="매물 상세정보 보기">${escapeHtml(x.title)}</button>${x.is_public?'':' '+badge('비공개','red')}<br><button class="photo-link" onclick="openListingPhotos('${x.id}')">📷 내부사진</button></td><td>${escapeHtml(listingAreaText(x))}</td><td>${listingPriceText(x)}</td><td>${crm382ContactDisplay(x)}</td><td>${x.loan_available===true?badge('O','green'):x.loan_available===false?badge('X','red'):badge('미확인','gray')}</td><td>${x.area_m2?`${x.area_m2}㎡<br><span class="muted">약 ${(Number(x.area_m2)/3.3058).toFixed(2)}평</span>`:'-'}</td><td>${listingRoomText(x)} / ${x.bathroom_count??'-'}</td><td>${moveInText(x)}</td><td>${escapeHtml(x.owner?.full_name||'-')}</td><td>${contractStage(x)}</td><td>${fmtDate(x.last_follow_up_at||x.last_confirmed_at)}</td><td>${dueBadge(x.next_follow_up_at)}</td>${mine?`<td><div class="row-actions"><button class="success" onclick="openFollowUpModal('listing','${x.id}')">FU</button><button class="ghost" onclick="openHistoryModal('listing','${x.id}')">히스토리</button><button class="ghost" onclick="openContractModal('listing','${x.id}')">진행상황</button><button class="ghost" onclick="openListingModal('${x.id}')">수정</button>${adminMode?`<button class="primary" onclick="openSingleListingTransfer('${x.id}')">개별 이관</button>`:''}<button class="danger" onclick="deleteListing('${x.id}')">삭제</button></div></td>`:''}</tr>`).join('')}</tbody></table></div>`:'<div class="empty">조건에 맞는 매물이 없습니다.</div>';
  if(adminMode)updateBulkTransferControls();
};

filterCustomers=function(){
  const q=($('#customerSearch')?.value||'').toLowerCase(),t=$('#customerType')?.value||'',s=$('#customerStatus')?.value||'',d=$('#customerDealType')?.value||'',g=$('#customerGrade')?.value||'';
  const rows=state.customers.filter(x=>(!q||`${x.name} ${x.phone}`.toLowerCase().includes(q))&&(!t||x.customer_type===t)&&(!s||x.status===s)&&(!d||x.deal_type===d)&&(!g||x.customer_grade===g));
  state.filteredCustomers=rows;
  $('#customerTable').innerHTML=rows.length?`<div class="table-wrap"><table class="customer-table crm3824-numbered-table"><thead><tr><th class="crm3824-no-col">순번</th><th>고객명</th><th>연락처</th><th>단계</th><th>미접촉</th><th>거래유형</th><th>등급</th><th>희망지역</th><th>방</th><th>희망금액/월세</th><th>진행상황</th><th>최종 FU</th><th>예정 FU</th><th>관리</th></tr></thead><tbody>${rows.map((x,index)=>{const dorm=crm37DormantInfo(x);return `<tr><td class="crm3824-no-cell">${index+1}</td><td><strong>${escapeHtml(x.name)}</strong></td><td>${escapeHtml(x.phone||'-')}</td><td>${badge(x.status||'신규 문의','blue')}</td><td>${dorm.label?badge(dorm.label,dorm.color):badge('최근 연락','green')}</td><td>${escapeHtml(x.deal_type||'-')}</td><td>${gradeBadge(x.customer_grade)}</td><td>${escapeHtml(x.preferred_area||'-')}</td><td>${customerRoomText(x)}</td><td>${customerBudgetText(x)}</td><td>${contractStage(x)}</td><td>${fmtDate(x.last_follow_up_at)}</td><td>${dueBadge(x.next_follow_up_at)}</td><td><div class="row-actions"><button class="success" onclick="openFollowUpModal('customer','${x.id}')">FU</button><button class="ghost" onclick="openHistoryModal('customer','${x.id}')">히스토리</button><button class="ghost" onclick="openContractModal('customer','${x.id}')">진행상황</button><button class="ghost" onclick="openCustomerModal('${x.id}')">수정</button><button class="danger" onclick="deleteCustomer('${x.id}')">삭제</button></div></td></tr>`}).join('')}</tbody></table></div>`:'<div class="empty">조건에 맞는 고객이 없습니다.</div>';
};

Object.assign(window,{renderMyListings,renderListingTable,filterCustomers});

// ===== CRM v3.8.25 매물 집계 분리·주소행 순번 제거 =====
function crm3825ListingSummary(rows){
  const counts={전체:rows.length,매매:0,전세:0,월세:0};
  rows.forEach(x=>{
    const type=crm3824PreferredDealType(x);
    if(Object.prototype.hasOwnProperty.call(counts,type)) counts[type]++;
  });
  return `<section class="crm3825-summary-panel" aria-label="내 매물 현황">
    <div class="crm3825-summary-title">내 매물 현황</div>
    <div class="crm3825-summary-items">
      <div><span>전체</span><strong>${counts.전체}</strong></div>
      <div><span>매매</span><strong>${counts.매매}</strong></div>
      <div><span>전세</span><strong>${counts.전세}</strong></div>
      <div><span>월세</span><strong>${counts.월세}</strong></div>
    </div>
  </section>`;
}

renderMyListings=async function(){
  await loadListings();
  state.myListings=state.listings.filter(x=>x.owner_id===state.profile.id);
  $('#topActions').innerHTML='<button class="primary" onclick="openListingModal()">+ 매물 등록</button>';
  $('#content').innerHTML=`${crm3825ListingSummary(state.myListings)}
    <div class="notice crm3825-my-listing-notice" style="margin-bottom:14px">이 시트에서 등록한 매물은 공개 상태가 ‘공개’인 경우 공동매물망에 자동으로 올라갑니다.</div>
    <div class="panel"><div id="myListingTable"></div></div>`;
  renderListingTable(state.myListings,'myListingTable',true);
  crm37AddQuickActions();
};

renderListingTable=function(rows,target,mine,adminMode=false){
  const el=$('#'+target);
  const totalCols=1+(adminMode?1:0)+16+(mine?1:0);
  el.innerHTML=rows.length?`<div class="table-wrap listing-table-wrap"><table class="listing-table crm3813-listing-table crm3824-numbered-table"><thead><tr><th class="crm3824-no-col">순번</th>${adminMode?'<th class="select-col">선택</th>':''}<th>상태</th><th>거래</th><th>유형</th><th>매물명</th><th>지역</th><th>금액</th><th>연락처</th><th>대출</th><th>전용면적</th><th>방/욕실</th><th>입주</th><th>담당</th><th>진행상황</th><th>최종 FU</th><th>예정 FU</th>${mine?'<th>관리</th>':''}</tr></thead><tbody>${rows.map((x,index)=>`<tr class="crm3813-address-row"><td class="crm3825-address-spacer"></td>${adminMode?'<td></td>':''}<td colspan="3"><div title="${escapeHtml(x.address||x.district||'주소 미입력')}">${escapeHtml(x.address||x.district||'주소 미입력')}</div></td><td colspan="${totalCols-1-(adminMode?1:0)-3}"></td></tr><tr><td class="crm3824-no-cell">${index+1}</td>${adminMode?`<td><input type="checkbox" class="admin-listing-check" value="${x.id}" onchange="toggleAdminListingSelection('${x.id}',this.checked)"></td>`:''}<td>${badge(x.status==='available'?'거래 가능':x.status==='complete'?'거래 완료':'협의 중',x.status==='available'?'green':x.status==='complete'?'gray':'yellow')}</td><td>${escapeHtml(crm38DealTypeText(x))}</td><td>${escapeHtml(x.property_type)}</td><td><button type="button" class="crm3814-listing-title-link" onclick="openListingDetail('${x.id}')" title="매물 상세정보 보기">${escapeHtml(x.title)}</button>${x.is_public?'':' '+badge('비공개','red')}<br><button class="photo-link" onclick="openListingPhotos('${x.id}')">📷 내부사진</button></td><td>${escapeHtml(listingAreaText(x))}</td><td>${listingPriceText(x)}</td><td>${crm382ContactDisplay(x)}</td><td>${x.loan_available===true?badge('O','green'):x.loan_available===false?badge('X','red'):badge('미확인','gray')}</td><td>${x.area_m2?`${x.area_m2}㎡<br><span class="muted">약 ${(Number(x.area_m2)/3.3058).toFixed(2)}평</span>`:'-'}</td><td>${listingRoomText(x)} / ${x.bathroom_count??'-'}</td><td>${moveInText(x)}</td><td>${escapeHtml(x.owner?.full_name||'-')}</td><td>${contractStage(x)}</td><td>${fmtDate(x.last_follow_up_at||x.last_confirmed_at)}</td><td>${dueBadge(x.next_follow_up_at)}</td>${mine?`<td><div class="row-actions"><button class="success" onclick="openFollowUpModal('listing','${x.id}')">FU</button><button class="ghost" onclick="openHistoryModal('listing','${x.id}')">히스토리</button><button class="ghost" onclick="openContractModal('listing','${x.id}')">진행상황</button><button class="ghost" onclick="openListingModal('${x.id}')">수정</button>${adminMode?`<button class="primary" onclick="openSingleListingTransfer('${x.id}')">개별 이관</button>`:''}<button class="danger" onclick="deleteListing('${x.id}')">삭제</button></div></td>`:''}</tr>`).join('')}</tbody></table></div>`:'<div class="empty">조건에 맞는 매물이 없습니다.</div>';
  if(adminMode) updateBulkTransferControls();
};

Object.assign(window,{renderMyListings,renderListingTable});

// ===== CRM v3.8.26 필터 연동 매물 집계 · 상태 2단계 =====
function crm3827HasContractProgress(listing){
  return !!(
    listing?.provisional_contract_completed ||
    listing?.contract_completed ||
    (!listing?.interim_payment_not_applicable && listing?.interim_payment_completed) ||
    listing?.final_payment_completed
  );
}
function crm3826StatusValue(listing){
  // 가계약 이상 진행 완료가 체크된 매물은 더 이상 거래 가능으로 표시하지 않는다.
  return (crm3827HasContractProgress(listing) || listing?.status==='complete') ? 'complete' : 'available';
}
function crm3826PreferredDealType(listing){
  return crm3824PreferredDealType(listing);
}
function crm3826SummaryMarkup(rows,title='필터 결과'){
  const counts={전체:rows.length,매매:0,전세:0,월세:0};
  rows.forEach(x=>{
    const type=crm3826PreferredDealType(x);
    if(type in counts) counts[type]++;
  });
  return `<section class="crm3826-filter-summary" aria-live="polite">
    <div class="crm3826-filter-summary-title">${escapeHtml(title)}</div>
    <div class="crm3826-filter-summary-grid">
      <div><span>전체</span><strong>${counts.전체}</strong></div>
      <div><span>매매</span><strong>${counts.매매}</strong></div>
      <div><span>전세</span><strong>${counts.전세}</strong></div>
      <div><span>월세</span><strong>${counts.월세}</strong></div>
    </div>
  </section>`;
}
function crm3826RenderSummary(targetId,rows,title){
  const el=document.getElementById(targetId);
  if(el) el.innerHTML=crm3826SummaryMarkup(rows,title);
}
function crm3826FilterRows(source,prefix){
  const q=crm3821RegionSearchKey(document.getElementById(`${prefix}Search`)?.value||'');
  const tx=document.getElementById(`${prefix}Tx`)?.value||'';
  const ty=document.getElementById(`${prefix}Type`)?.value||'';
  const st=document.getElementById(`${prefix}Status`)?.value||'';
  const mx=Number(document.getElementById(`${prefix}Max`)?.value||0);
  return source.filter(x=>{
    const hay=crm3821RegionSearchKey(`${x.title||''} ${x.address||''} ${x.district||''} ${x.owner?.full_name||''} ${x.owner?.office_name||''}`);
    if(q&&!hay.includes(q))return false;
    if(ty&&x.property_type!==ty)return false;
    if(st&&crm3826StatusValue(x)!==st)return false;
    const opts=crm38DealOptions(x)||[];
    const matching=tx?opts.filter(o=>o.deal_type===tx):opts;
    if(tx&&!matching.length)return false;
    if(mx&&!matching.some(o=>Number(o.price||0)<=mx))return false;
    return true;
  });
}
function crm3826FilterBar(prefix){
  return `<div class="filters crm3826-listing-filters">
    <input id="${prefix}Search" placeholder="매물명·주소·지역 검색" oninput="${prefix==='myListing'?'filterMyListings()':'filterNetwork()'}">
    <select id="${prefix}Tx" onchange="${prefix==='myListing'?'filterMyListings()':'filterNetwork()'}"><option value="">전체 거래</option><option>매매</option><option>전세</option><option>월세</option></select>
    <select id="${prefix}Type" onchange="${prefix==='myListing'?'filterMyListings()':'filterNetwork()'}"><option value="">전체 유형</option><option>아파트</option><option>오피스텔</option><option>빌라</option><option>상가</option><option>사무실</option><option>토지</option></select>
    <select id="${prefix}Status" onchange="${prefix==='myListing'?'filterMyListings()':'filterNetwork()'}"><option value="">전체 상태</option><option value="available">거래 가능</option><option value="complete">거래 완료</option></select>
    <input id="${prefix}Max" type="number" min="0" placeholder="최대금액(만원)" oninput="${prefix==='myListing'?'filterMyListings()':'filterNetwork()'}">
  </div>`;
}

renderMyListings=async function(){
  await loadListings();
  state.myListings=state.listings.filter(x=>x.owner_id===state.profile.id);
  $('#topActions').innerHTML='<button class="primary" onclick="openListingModal()">+ 매물 등록</button>';
  $('#content').innerHTML=`
    <div class="notice crm3826-my-listing-notice">이 시트에서 등록한 매물은 공개 상태가 ‘공개’인 경우 공동매물망에 자동으로 올라갑니다.</div>
    <div class="panel crm3826-filter-panel">
      ${crm3826FilterBar('myListing')}
      <div id="myListingSummary"></div>
      <div id="myListingTable"></div>
    </div>`;
  filterMyListings();
  crm37AddQuickActions();
};

filterMyListings=function(){
  const rows=crm3826FilterRows(state.myListings||[],'myListing');
  state.filteredMyListings=rows;
  crm3826RenderSummary('myListingSummary',rows,'내 매물 필터 결과');
  renderListingTable(rows,'myListingTable',true);
};

renderNetwork=async function(){
  await loadListings();
  $('#topActions').innerHTML='';
  $('#content').innerHTML=`<div class="panel crm3826-filter-panel">
    ${crm3826FilterBar('listing')}
    <div id="networkSummary"></div>
    <div id="networkTable"></div>
  </div>`;
  filterNetwork();
};

filterNetwork=function(){
  const publicRows=state.listings.filter(x=>x.is_public);
  const rows=crm3826FilterRows(publicRows,'listing');
  state.filteredNetworkListings=rows;
  crm3826RenderSummary('networkSummary',rows,'공동매물망 필터 결과');
  renderListingTable(rows,'networkTable',false);
};

// 매물 등록/수정의 상태는 거래 가능·거래 완료만 사용한다.
const crm3826OpenListingModalBase=openListingModal;
openListingModal=function(id){
  crm3826OpenListingModalBase(id);
  const select=document.querySelector('#modalBody select[name="status"]');
  if(select){
    const listing=state.listings.find(x=>x.id===id);
    select.innerHTML='<option value="available">거래 가능</option><option value="complete">거래 완료</option>';
    select.value=crm3826StatusValue(listing);
  }
};

// FU 안에서도 협의 중 상태를 다시 만들지 못하도록 제거한다.
const crm3826OpenFollowUpModalBase=openFollowUpModal;
openFollowUpModal=async function(entityType,id){
  await crm3826OpenFollowUpModalBase(entityType,id);
  if(entityType!=='listing')return;
  const result=document.getElementById('crm361ConfirmResult');
  if(result){
    [...result.options].filter(o=>o.value==='협의 중'||o.textContent.trim()==='협의 중').forEach(o=>o.remove());
  }
};

// 목록에서도 기존 hold 데이터는 거래 가능으로 표현한다.
const crm3826RenderListingTableBase=renderListingTable;
renderListingTable=function(rows,target,mine,adminMode=false){
  const normalized=rows.map(x=>({...x,status:crm3826StatusValue(x)}));
  crm3826RenderListingTableBase(normalized,target,mine,adminMode);
};

Object.assign(window,{renderMyListings,filterMyListings,renderNetwork,filterNetwork,openListingModal,openFollowUpModal,renderListingTable});
console.info('CRM v3.8.26 필터 연동 집계 및 상태 2단계 적용 완료');

// ===== CRM v3.8.27 진행상황-매물상태 자동연동 =====
console.info('CRM v3.8.27 진행상황에 따른 매물 상태 자동연동 적용 완료');

// ===== CRM v3.8.29 매물유형 세분화 · 광고관리 =====
function crm3829PropertyTypeOptions(selected=''){
  const types=['아파트','오피스텔','단독','다가구','다세대','원룸','상가','사무실','토지','기타'];
  return types.map(v=>`<option value="${v}" ${selected===v?'selected':''}>${v}</option>`).join('');
}
function crm3829AdBadges(x){
  const items=[];
  if(x.ad_naver) items.push('<span class="crm3829-ad-badge crm3829-ad-s" title="네이버">S</span>');
  if(x.ad_danggeun) items.push('<span class="crm3829-ad-badge crm3829-ad-d" title="당근">D</span>');
  if(x.ad_zippl) items.push('<span class="crm3829-ad-badge crm3829-ad-z" title="집플 등">Z</span>');
  if(x.ad_blog) items.push('<span class="crm3829-ad-badge crm3829-ad-b" title="블로그">B</span>');
  return items.length?`<span class="crm3829-ad-badges">${items.join('')}</span>`:'';
}
function crm3829AdHistoryText(before,after){
  const labels={ad_naver:'네이버',ad_danggeun:'당근',ad_zippl:'집플 등',ad_blog:'블로그'};
  const lines=['광고 변경',`변경일: ${today()}`];
  Object.keys(labels).forEach(k=>{
    if(!before[k]&&after[k]) lines.push(`${labels[k]} 광고 등록`);
    else if(before[k]&&!after[k]) lines.push(`${labels[k]} 광고 내림`);
    else if(before[k]&&after[k]) lines.push(`${labels[k]} 광고 유지`);
  });
  return lines.join('\n');
}

// 매물 등록/수정에서 빌라를 제거하고 세부 유형으로 교체한다.
const crm3829OpenListingModalBase=openListingModal;
openListingModal=function(id){
  crm3829OpenListingModalBase(id);
  const listing=state.listings.find(x=>x.id===id);
  const select=document.querySelector('#modalBody select[name="property_type"]');
  if(select){
    select.innerHTML=crm3829PropertyTypeOptions(listing?.property_type||select.value||'');
    if(listing?.property_type==='빌라') select.value='다세대';
  }
};

// 필터의 매물 유형도 동일하게 구성한다.
crm3826FilterBar=function(prefix){
  const handler=prefix==='myListing'?'filterMyListings()':'filterNetwork()';
  return `<div class="filters crm3826-listing-filters">
    <input id="${prefix}Search" placeholder="매물명·주소·지역 검색" oninput="${handler}">
    <select id="${prefix}Tx" onchange="${handler}"><option value="">전체 거래</option><option>매매</option><option>전세</option><option>월세</option></select>
    <select id="${prefix}Type" onchange="${handler}"><option value="">전체 유형</option>${crm3829PropertyTypeOptions('')}</select>
    <select id="${prefix}Status" onchange="${handler}"><option value="">전체 상태</option><option value="available">거래 가능</option><option value="complete">거래 완료</option></select>
    <input id="${prefix}Max" type="number" min="0" placeholder="최대금액(만원)" oninput="${handler}">
  </div>`;
};

const crm3829RenderAdminListingsBase=renderAdminListings;
renderAdminListings=async function(){
  await crm3829RenderAdminListingsBase();
  const select=document.getElementById('adminListingType');
  if(select) select.innerHTML=`<option value="">전체 유형</option>${crm3829PropertyTypeOptions('')}`;
};

// 진행상황 창을 광고 / 계약진행 두 섹션으로 나눈다.
const crm3829OpenContractModalBase=openContractModal;
openContractModal=async function(entityType,id){
  await crm3829OpenContractModalBase(entityType,id);
  if(entityType!=='listing') return;
  const listing=state.listings.find(x=>x.id===id);
  if(!listing) return;
  const editor=document.querySelector('#modalBody .contract-editor');
  const contractBox=document.querySelector('#modalBody .contract-detail-box');
  if(!editor||!contractBox) return;
  contractBox.insertAdjacentHTML('beforebegin',`<section class="crm3829-ad-section">
    <div class="crm3829-section-head"><h4>광고</h4><span>체크 후 저장하면 광고 등록일과 매체가 히스토리에 남습니다.</span></div>
    <div class="crm3829-ad-checks">
      <label><input type="checkbox" id="crm3829AdNaver" ${listing.ad_naver?'checked':''}> 네이버</label>
      <label><input type="checkbox" id="crm3829AdDanggeun" ${listing.ad_danggeun?'checked':''}> 당근</label>
      <label><input type="checkbox" id="crm3829AdZippl" ${listing.ad_zippl?'checked':''}> 집플 등</label>
      <label><input type="checkbox" id="crm3829AdBlog" ${listing.ad_blog?'checked':''}> 블로그</label>
    </div>
  </section><div class="crm3829-contract-section-title"><h4>계약진행</h4></div>`);
  const oldHandler=$('#modalSubmit').onclick;
  $('#modalSubmit').onclick=async function(e){
    const values={
      ad_naver:!!document.getElementById('crm3829AdNaver')?.checked,
      ad_danggeun:!!document.getElementById('crm3829AdDanggeun')?.checked,
      ad_zippl:!!document.getElementById('crm3829AdZippl')?.checked,
      ad_blog:!!document.getElementById('crm3829AdBlog')?.checked
    };
    const dateMap={ad_naver:'ad_naver_at',ad_danggeun:'ad_danggeun_at',ad_zippl:'ad_zippl_at',ad_blog:'ad_blog_at'};
    const before={ad_naver:!!listing.ad_naver,ad_danggeun:!!listing.ad_danggeun,ad_zippl:!!listing.ad_zippl,ad_blog:!!listing.ad_blog};
    const payload={...values};
    Object.entries(dateMap).forEach(([flag,dateKey])=>{
      payload[dateKey]=values[flag]?(listing[dateKey]||today()):null;
    });
    const changed=Object.keys(values).some(k=>!!listing[k]!==values[k]);
    if(changed){
      const {error}=await state.client.from('listings').update(payload).eq('id',id);
      if(error){e?.preventDefault();return toast(`광고 저장 실패: ${error.message}`)}
      Object.assign(listing,payload);
      const {error:hErr}=await state.client.from('interaction_history').insert({
        listing_id:id,customer_id:null,created_by:state.profile.id,follow_up_date:today(),contact_method:'광고',content:crm3829AdHistoryText(before,values),next_follow_up_at:null
      });
      if(hErr){e?.preventDefault();return toast(`광고는 저장됐지만 히스토리 기록에 실패했습니다: ${hErr.message}`)}
    }
    return oldHandler?.call(this,e);
  };
};

// 주소 오른쪽에 광고 배지를 한 줄로 표시한다.
renderListingTable=function(rows,target,mine,adminMode=false){
  const normalized=rows.map(x=>({...x,status:crm3826StatusValue(x)}));
  const el=$('#'+target);
  const totalCols=1+(adminMode?1:0)+16+(mine?1:0);
  el.innerHTML=normalized.length?`<div class="table-wrap listing-table-wrap"><table class="listing-table crm3813-listing-table crm3824-numbered-table crm3839-reordered-table"><thead><tr><th class="crm3824-no-col">순번</th>${adminMode?'<th class="select-col">선택</th>':''}<th>상태</th><th class="crm3839-title-col">매물명</th><th>거래</th><th>유형</th><th>지역</th><th>금액</th><th>연락처</th><th>대출</th><th>전용면적</th><th>방/욕실</th><th>입주</th><th>담당</th><th>진행상황</th><th>최종 FU</th><th>예정 FU</th>${mine?'<th>관리</th>':''}</tr></thead><tbody>${normalized.map((x,index)=>`<tr class="crm3813-address-row"><td class="crm3825-address-spacer"></td>${adminMode?'<td></td>':''}<td colspan="4"><div class="crm3829-address-line" title="${escapeHtml(x.address||x.district||'주소 미입력')}"><span>${escapeHtml(x.address||x.district||'주소 미입력')}</span>${crm3829AdBadges(x)}</div></td><td colspan="${totalCols-1-(adminMode?1:0)-4}"></td></tr><tr><td class="crm3824-no-cell">${index+1}</td>${adminMode?`<td><input type="checkbox" class="admin-listing-check" value="${x.id}" onchange="toggleAdminListingSelection('${x.id}',this.checked)"></td>`:''}<td class="crm3839-center-cell">${badge(x.status==='available'?'거래 가능':'거래 완료',x.status==='available'?'green':'gray')}</td><td class="crm3839-title-cell"><button type="button" class="crm3814-listing-title-link" onclick="openListingDetail('${x.id}')" title="매물 상세정보 보기">${escapeHtml(x.title)}</button>${x.is_public?'':' '+badge('비공개','red')}<br><button class="photo-link" onclick="openListingPhotos('${x.id}')">📷 내부사진</button></td><td class="crm3839-center-cell">${escapeHtml(crm38DealTypeText(x))}</td><td class="crm3839-center-cell">${escapeHtml(x.property_type==='빌라'?'다세대':x.property_type)}</td><td>${escapeHtml(listingAreaText(x))}</td><td>${listingPriceText(x)}</td><td>${crm382ContactDisplay(x)}</td><td class="crm3839-center-cell">${x.loan_available===true?badge('O','green'):x.loan_available===false?badge('X','red'):badge('미확인','gray')}</td><td class="crm3839-center-cell">${x.area_m2?`${x.area_m2}㎡<br><span class="muted">약 ${(Number(x.area_m2)/3.3058).toFixed(2)}평</span>`:'-'}</td><td class="crm3839-center-cell">${listingRoomText(x)} / ${x.bathroom_count??'-'}</td><td>${moveInText(x)}</td><td class="crm3839-center-cell">${escapeHtml(x.owner?.full_name||'-')}</td><td class="crm3839-center-cell">${contractStage(x)}</td><td class="crm3839-center-cell crm3839-date-cell">${fmtDate(x.last_follow_up_at||x.last_confirmed_at)}</td><td class="crm3839-center-cell crm3839-date-cell">${dueBadge(x.next_follow_up_at)}</td>${mine?`<td><div class="row-actions"><button class="success" onclick="openFollowUpModal('listing','${x.id}')">FU</button><button class="ghost" onclick="openHistoryModal('listing','${x.id}')">히스토리</button><button class="ghost" onclick="openContractModal('listing','${x.id}')">진행상황</button><button class="ghost" onclick="openListingModal('${x.id}')">수정</button>${adminMode?`<button class="primary" onclick="openSingleListingTransfer('${x.id}')">개별 이관</button>`:''}<button class="danger" onclick="deleteListing('${x.id}')">삭제</button></div></td>`:''}</tr>`).join('')}</tbody></table></div>`:'<div class="empty">조건에 맞는 매물이 없습니다.</div>';
  if(adminMode) updateBulkTransferControls();
};

Object.assign(window,{openListingModal,openContractModal,renderListingTable,renderAdminListings});
console.info('CRM v3.8.29 매물유형 세분화 및 광고관리 적용 완료');

/* ===== CRM v3.8.30 매물유형·주소·예정 FU 분리 ===== */
function crm3830PropertyTypeOptions(selected=''){
  const normalized=selected==='원룸'?'기타':selected;
  const types=['아파트','오피스텔','단독','다가구','다세대','상가','사무실','토지','기타'];
  return types.map(v=>`<option value="${v}" ${normalized===v?'selected':''}>${v}</option>`).join('');
}
crm3829PropertyTypeOptions=crm3830PropertyTypeOptions;

// 매물 등록·수정과 필터에서 원룸 유형을 제거한다.
const crm3830OpenListingModalBase=openListingModal;
openListingModal=function(id){
  crm3830OpenListingModalBase(id);
  const listing=state.listings.find(x=>x.id===id);
  const select=document.querySelector('#modalBody select[name="property_type"]');
  if(select){
    select.innerHTML=crm3830PropertyTypeOptions(listing?.property_type||select.value||'');
    if(listing?.property_type==='원룸') select.value='기타';
  }
};

crm3826FilterBar=function(prefix){
  const handler=prefix==='myListing'?'filterMyListings()':'filterNetwork()';
  return `<div class="filters crm3826-listing-filters">
    <input id="${prefix}Search" placeholder="매물명·주소·지역 검색" oninput="${handler}">
    <select id="${prefix}Tx" onchange="${handler}"><option value="">전체 거래</option><option>매매</option><option>전세</option><option>월세</option></select>
    <select id="${prefix}Type" onchange="${handler}"><option value="">전체 유형</option>${crm3830PropertyTypeOptions('')}</select>
    <select id="${prefix}Status" onchange="${handler}"><option value="">전체 상태</option><option value="available">거래 가능</option><option value="complete">거래 완료</option></select>
    <input id="${prefix}Max" type="number" min="0" placeholder="최대금액(만원)" oninput="${handler}">
  </div>`;
};

const crm3830RenderAdminListingsBase=renderAdminListings;
renderAdminListings=async function(){
  await crm3830RenderAdminListingsBase();
  const select=document.getElementById('adminListingType');
  if(select) select.innerHTML=`<option value="">전체 유형</option>${crm3830PropertyTypeOptions('')}`;
};

function crm3830RefreshListingScreen(){
  if(state.view==='adminListings') return renderAdminListings();
  if(state.view==='network') return renderNetwork();
  return renderMyListings();
}

crm361SetFuTab=function(tab){
  $$('.crm361-fu-tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
  $$('.crm361-fu-panel').forEach(p=>p.classList.toggle('hidden',p.dataset.panel!==tab));
  const submit=$('#modalSubmit');
  if(!submit)return;
  submit.style.display=tab==='history'?'none':'';
  submit.textContent=tab==='schedule'?'예정 FU 저장':'저장';
  if(tab==='history')crm361LoadPriceHistory($('#crm361ListingId').value);
};

crm361OpenListingFu=async function(id){
  const item=state.listings.find(x=>x.id===id);if(!item)return toast('매물을 찾지 못했습니다.');
  const oldOpts=crm38DealOptions(item).map(o=>({...o}));
  const map=Object.fromEntries(oldOpts.map(o=>[o.deal_type,{...o,checked:true}]));
  $('#modalTitle').textContent=`${item.title} · FU 관리`;
  $('#modalBody').innerHTML=`<input id="crm361ListingId" type="hidden" value="${id}">
  <div class="crm361-fu-tabs crm3830-fu-tabs">
    <button type="button" class="crm361-fu-tab active" data-tab="record" onclick="crm361SetFuTab('record')">FU 기록</button>
    <button type="button" class="crm361-fu-tab" data-tab="schedule" onclick="crm361SetFuTab('schedule')">예정 FU</button>
    <button type="button" class="crm361-fu-tab" data-tab="history" onclick="crm361SetFuTab('history')">가격 이력</button>
  </div>
  <section class="crm361-fu-panel" data-panel="record">
    <div class="form-grid">
      <label>기록 일자<input id="crm361FuDate" type="date" value="${today()}" required></label>
      <label>상담 종류<select id="crm361FuMethod"><option>전화</option><option>대면투어</option><option>촬영</option><option>문자/톡 발송</option><option>문자/톡 수신</option><option>부재중</option><option>가계약</option><option>본계약</option><option>중도금</option><option>잔금</option><option>기타</option></select></label>
      <label class="span-2">상담·진행 내용<textarea id="crm361FuContent" rows="6" placeholder="통화 내용, 조건 변경, 다음 조치 등을 구체적으로 기록하세요."></textarea></label>
    </div>
    <div class="crm387-confirm-wrap">
      <label class="inline-check crm387-confirm-toggle"><input id="crm387UseConfirm" type="checkbox" onchange="crm387ToggleConfirmBlock()"> 거래조건 변경</label>
      <div id="crm387ConfirmBlock" hidden>
        <div class="notice">현재 가능한 거래유형과 가격을 저장합니다. 추가·종료·가격변경 내용은 매물 정보, 가격 이력, FU 히스토리에 함께 반영됩니다.</div>
        <div class="form-grid" style="margin-top:14px">
          <label>확인 결과<select id="crm361ConfirmResult"><option>거래 가능</option><option>가격 변경</option><option>거래 완료</option><option>연락 안 됨</option><option>재확인 필요</option></select></label>
          <div></div>
          <div class="span-2 crm386-fu-deals">${crm386FuDealCard('매매',map['매매']||{})}${crm386FuDealCard('전세',map['전세']||{})}${crm386FuDealCard('월세',map['월세']||{})}</div>
        </div>
      </div>
    </div>
  </section>
  <section class="crm361-fu-panel hidden" data-panel="schedule">
    <div class="crm3830-schedule-card">
      <div>
        <h4>예정 FU 일정</h4>
        <p>이 날짜는 FU 히스토리와 최종 FU에 영향을 주지 않고, 매물 리스트의 예정 FU에만 반영됩니다.</p>
      </div>
      <label>예정 FU<input id="crm3830ScheduleDate" type="date" value="${item.next_follow_up_at?item.next_follow_up_at.slice(0,10):''}"></label>
      <button type="button" class="ghost crm3830-clear-schedule" onclick="document.getElementById('crm3830ScheduleDate').value=''">일정 지우기</button>
    </div>
  </section>
  <section class="crm361-fu-panel hidden" data-panel="history"><div id="crm361PriceHistory"></div></section>`;
  $('#modalSubmit').style.display='';
  $('#modalSubmit').textContent='저장';
  $('#modalSubmit').onclick=async e=>{
    e.preventDefault();
    const active=$('.crm361-fu-tab.active')?.dataset.tab||'record';
    if(active==='history')return;
    if(active==='schedule'){
      const next=$('#crm3830ScheduleDate').value||null;
      const {error}=await state.client.from('listings').update({next_follow_up_at:next}).eq('id',id);
      if(error)return toast(`예정 FU 저장 실패: ${error.message}`);
      item.next_follow_up_at=next;
      $('#modal').close();
      toast(next?'예정 FU 일정을 변경했습니다.':'예정 FU 일정을 삭제했습니다.');
      return crm3830RefreshListingScreen();
    }
    const content=$('#crm361FuContent').value.trim();
    const useConfirm=!!$('#crm387UseConfirm')?.checked;
    if(!content&&!useConfirm)return toast('FU 내용 또는 거래조건 변경 내용을 입력하세요.');
    const fuDate=$('#crm361FuDate').value||today();
    let diffText='',result='';
    if(useConfirm){
      const newOpts=crm386CollectFuDeals();if(!newOpts.length)return toast('거래유형을 하나 이상 체크하세요.');
      const preferred=newOpts.find(o=>o.is_preferred)||newOpts[0];preferred.is_preferred=true;
      result=$('#crm361ConfirmResult').value;
      const {error:logErr}=await state.client.from('listing_confirmation_logs').insert({listing_id:id,confirmed_by:state.profile.id,result,note:null,confirmed_price:preferred.price??null,confirmed_monthly_rent:preferred.monthly_rent??null,next_confirm_at:null});if(logErr)return toast(logErr.message);
      const {error:delErr}=await state.client.from('listing_deal_options').delete().eq('listing_id',id);if(delErr)return toast(delErr.message);
      const {error:insErr}=await state.client.from('listing_deal_options').insert(newOpts.map(o=>({...o,listing_id:id})));if(insErr)return toast(insErr.message);
      const update={last_confirmed_at:fuDate,next_confirm_at:null,transaction_type:preferred.deal_type,price:preferred.price,monthly_rent:preferred.monthly_rent,last_follow_up_at:fuDate};
      if(result==='거래 완료')update.status='complete';else if(result==='거래 가능')update.status='available';
      const {error:uErr}=await state.client.from('listings').update(update).eq('id',id);if(uErr)return toast(uErr.message);
      const diff=crm385DiffDealOptions(oldOpts,newOpts);
      diffText=diff.map(c=>c.kind==='add'?`${c.type} 조건 추가 · ${crm385DealValueText(c.newO)}`:c.kind==='remove'?`${c.type} 조건 종료 · ${crm385DealValueText(c.oldO)}`:`${c.type} 가격 변경 · ${crm385DealValueText(c.oldO)} → ${crm385DealValueText(c.newO)}`).join('\n');
      const priceRows=diff.map(c=>({listing_id:id,changed_by:state.profile.id,transaction_type:c.type,old_price:c.oldO?.price??null,new_price:c.newO?.price??null,old_monthly_rent:c.oldO?.monthly_rent??null,new_monthly_rent:c.newO?.monthly_rent??null}));
      if(priceRows.length){const {error:priceErr}=await state.client.from('listing_price_history').insert(priceRows);if(priceErr)toast(`가격 이력 저장 실패: ${priceErr.message}`)}
    }
    const parts=[];
    if(content)parts.push(content);
    if(useConfirm)parts.push(`확인 결과: ${result}${diffText?`\n${diffText}`:''}`);
    const {error:hErr}=await state.client.from('interaction_history').insert({created_by:state.profile.id,follow_up_date:fuDate,contact_method:useConfirm?'매물확인':$('#crm361FuMethod').value,content:parts.join('\n\n'),next_follow_up_at:null,listing_id:id});
    if(hErr)return toast(hErr.message);
    if(!useConfirm){const {error:uErr}=await state.client.from('listings').update({last_follow_up_at:fuDate}).eq('id',id);if(uErr)return toast(uErr.message)}
    await loadListings();
    $('#modal').close();
    toast(useConfirm?'FU와 거래조건 변경을 저장했습니다. 예정 FU는 변경되지 않았습니다.':'FU 기록을 저장했습니다. 예정 FU는 변경되지 않았습니다.');
    return crm3830RefreshListingScreen();
  };
  $('#modal').showModal();
};
openFollowUpModal=function(entityType,id){return entityType==='listing'?crm361OpenListingFu(id):crm361BaseOpenFollowUpModal(entityType,id)};

// 기존 원룸 데이터는 목록에서 기타로 표시한다.
const crm3830RenderListingTableBase=renderListingTable;
renderListingTable=function(rows,target,mine,adminMode=false){
  crm3830RenderListingTableBase(rows.map(x=>x.property_type==='원룸'?{...x,property_type:'기타'}:x),target,mine,adminMode);
};

Object.assign(window,{openListingModal,renderAdminListings,crm361SetFuTab,crm361OpenListingFu,openFollowUpModal,renderListingTable});
console.info('CRM v3.8.30 매물유형 원룸 제거·주소 확대·예정 FU 분리 적용 완료');

/* ===== CRM v3.8.31 리스트 FU·관리영역 압축 ===== */
function crm3831ShortDate(value){
  if(!value)return '-';
  const raw=String(value).slice(0,10);
  const parts=raw.split('-');
  if(parts.length!==3)return raw;
  return `${parts[0].slice(2)}.${Number(parts[1])}.${Number(parts[2])}`;
}
function crm3831DueDate(value){
  if(!value)return '-';
  const d=new Date(String(value).slice(0,10)+'T00:00:00');
  const now=new Date(today()+'T00:00:00');
  const diff=Math.round((d-now)/86400000);
  const cls=diff<0?'red':diff===0?'yellow':'blue';
  return `<span class="badge ${cls} crm3831-date-badge">${crm3831ShortDate(value)}</span>`;
}
const crm3831RenderListingTableBase=renderListingTable;
renderListingTable=function(rows,target,mine,adminMode=false){
  crm3831RenderListingTableBase(rows,target,mine,adminMode);
  const root=document.getElementById(target);
  if(!root)return;
  const table=root.querySelector('table');
  if(!table)return;
  const headers=[...table.querySelectorAll('thead th')];
  const finalIndex=headers.findIndex(th=>th.textContent.trim()==='최종 FU');
  const nextIndex=headers.findIndex(th=>th.textContent.trim()==='예정 FU');
  const manageIndex=headers.findIndex(th=>th.textContent.trim()==='관리');
  if(finalIndex>=0)headers[finalIndex].classList.add('crm3831-fu-col');
  if(nextIndex>=0)headers[nextIndex].classList.add('crm3831-fu-col');
  if(manageIndex>=0)headers[manageIndex].classList.add('crm3831-manage-col');
  const dataRows=[...table.querySelectorAll('tbody tr:not(.crm3813-address-row)')];
  dataRows.forEach((tr,index)=>{
    const cells=[...tr.children];
    const item=rows[index];
    if(!item)return;
    if(finalIndex>=0&&cells[finalIndex]){
      cells[finalIndex].classList.add('crm3831-fu-cell');
      cells[finalIndex].textContent=crm3831ShortDate(item.last_follow_up_at||item.last_confirmed_at);
    }
    if(nextIndex>=0&&cells[nextIndex]){
      cells[nextIndex].classList.add('crm3831-fu-cell');
      cells[nextIndex].innerHTML=crm3831DueDate(item.next_follow_up_at);
    }
    if(manageIndex>=0&&cells[manageIndex]){
      cells[manageIndex].classList.add('crm3831-manage-cell');
      const actions=cells[manageIndex].querySelector('.row-actions');
      if(actions)actions.classList.add('crm3831-grid-actions');
    }
  });
};
Object.assign(window,{renderListingTable});
console.info('CRM v3.8.31 리스트 FU 및 관리영역 압축 적용 완료');

console.info('CRM v3.8.32 공지사항 압축 및 광고 변경이력 적용 완료');

console.info('CRM v3.8.33 주소행 간격 축소 적용 완료');

console.info('CRM v3.8.38 주소·광고 상단 배치 복원 완료');

/* ===== CRM v3.8.41 내 매물·공동매물망 열간격 통일 / 광고 아이콘 주소 옆 배치 ===== */
const crm3841RenderListingTableBase=renderListingTable;
renderListingTable=function(rows,target,mine,adminMode=false){
  crm3841RenderListingTableBase(rows,target,mine,adminMode);
  const root=document.getElementById(target);
  const table=root?.querySelector('table.crm3839-reordered-table');
  if(!table)return;

  const headers=[...table.querySelectorAll('thead th')];
  const classByName={
    '순번':'crm3841-col-no',
    '상태':'crm3841-col-status',
    '매물명':'crm3841-col-title',
    '거래':'crm3841-col-trade',
    '유형':'crm3841-col-type',
    '지역':'crm3841-col-region',
    '금액':'crm3841-col-price',
    '연락처':'crm3841-col-contact'
  };
  headers.forEach((th,index)=>{
    const cls=classByName[th.textContent.trim()];
    if(!cls)return;
    th.classList.add(cls);
    table.querySelectorAll('tbody tr:not(.crm3813-address-row)').forEach(tr=>{
      tr.children[index]?.classList.add(cls);
    });
  });

  table.querySelectorAll('.crm3829-address-line').forEach(line=>{
    line.classList.add('crm3841-address-line');
    const badges=line.querySelector('.crm3829-ad-badges');
    if(badges)badges.classList.add('crm3841-address-badges');
  });
};
Object.assign(window,{renderListingTable});
console.info('CRM v3.8.41 공동매물망 열간격 통일 및 광고 아이콘 주소 옆 배치 완료');

/* ===== CRM v3.8.42 내 매물·공동매물망 열 정렬 통일 / 내부사진 간격 축소 ===== */
const crm3842RenderListingTableBase=renderListingTable;
renderListingTable=function(rows,target,mine,adminMode=false){
  crm3842RenderListingTableBase(rows,target,mine,adminMode);
  const root=document.getElementById(target);
  const table=root?.querySelector('table.crm3839-reordered-table');
  if(!table)return;

  const alignByHeader={
    '순번':['crm3842-center','crm3842-nowrap'],
    '선택':['crm3842-center','crm3842-nowrap'],
    '상태':['crm3842-center','crm3842-nowrap'],
    '매물명':['crm3842-left','crm3842-title-cell'],
    '거래':['crm3842-center','crm3842-nowrap'],
    '유형':['crm3842-center','crm3842-nowrap'],
    '지역':['crm3842-center','crm3842-nowrap'],
    '금액':['crm3842-left','crm3842-price-cell'],
    '연락처':['crm3842-left','crm3842-contact-cell'],
    '대출':['crm3842-center','crm3842-nowrap'],
    '전용면적':['crm3842-center','crm3842-nowrap'],
    '방/욕실':['crm3842-center','crm3842-nowrap'],
    '입주':['crm3842-center'],
    '담당':['crm3842-center','crm3842-nowrap'],
    '진행상황':['crm3842-center','crm3842-nowrap'],
    '최종 FU':['crm3842-center','crm3842-nowrap'],
    '예정 FU':['crm3842-center','crm3842-nowrap'],
    '관리':['crm3842-center']
  };

  const headers=[...table.querySelectorAll('thead th')];
  const dataRows=[...table.querySelectorAll('tbody tr:not(.crm3813-address-row)')];
  headers.forEach((th,index)=>{
    const classes=alignByHeader[th.textContent.trim()]||[];
    classes.forEach(cls=>th.classList.add(cls));
    dataRows.forEach(tr=>{
      const td=tr.children[index];
      if(td)classes.forEach(cls=>td.classList.add(cls));
    });
  });
};
Object.assign(window,{renderListingTable});
console.info('CRM v3.8.42 매물표 열 정렬 및 내부사진 간격 개선 완료');

/* ===== CRM v3.8.43 매물표 열 간격·폭 균형 정리 ===== */
const crm3843RenderListingTableBase=renderListingTable;
renderListingTable=function(rows,target,mine,adminMode=false){
  crm3843RenderListingTableBase(rows,target,mine,adminMode);
  const root=document.getElementById(target);
  const table=root?.querySelector('table.crm3839-reordered-table');
  if(!table)return;

  const widthClassByHeader={
    '선택':'crm3843-col-select',
    '순번':'crm3843-col-no',
    '상태':'crm3843-col-status',
    '매물명':'crm3843-col-title',
    '거래':'crm3843-col-trade',
    '유형':'crm3843-col-type',
    '지역':'crm3843-col-region',
    '금액':'crm3843-col-price',
    '연락처':'crm3843-col-contact',
    '대출':'crm3843-col-loan',
    '전용면적':'crm3843-col-area',
    '방/욕실':'crm3843-col-room',
    '입주':'crm3843-col-movein',
    '담당':'crm3843-col-owner',
    '진행상황':'crm3843-col-stage',
    '최종 FU':'crm3843-col-lastfu',
    '예정 FU':'crm3843-col-nextfu',
    '관리':'crm3843-col-manage'
  };
  const headers=[...table.querySelectorAll('thead th')];
  const dataRows=[...table.querySelectorAll('tbody tr:not(.crm3813-address-row)')];
  headers.forEach((th,index)=>{
    const cls=widthClassByHeader[th.textContent.trim()];
    if(!cls)return;
    th.classList.add(cls);
    dataRows.forEach(tr=>tr.children[index]?.classList.add(cls));
  });
};
Object.assign(window,{renderListingTable});
console.info('CRM v3.8.43 매물표 열 폭과 간격 균형 정리 완료');

/* ===== CRM v3.8.48 개인·전체 일정 캘린더 / 매물명-사진 밀착 ===== */
state.calendarEvents=[];
state.calendarMonth='2026-07-01';
state.calendarShowAll=false;
state.calendarFilters=new Set(['계약일정','잔금일정','휴무일정','기타일정']);

const crm3848RenderViewBase=renderView;
renderView=async function(view){
  if(view==='calendar'){
    state.view=view;
    $$('.nav').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
    $('#pageTitle').textContent='캘린더';
    $('#pageSubtitle').textContent='내 일정 등록 및 중개사 전체 일정 확인';
    $('#topActions').innerHTML='';
    await crm3848RenderCalendar();
    return;
  }
  await crm3848RenderViewBase(view);
};

function crm3848CategoryClass(category){return {'계약일정':'contract','잔금일정':'balance','휴무일정':'holiday','기타일정':'other'}[category]||'other'}
function crm3848DateLocal(date){const y=date.getFullYear(),m=String(date.getMonth()+1).padStart(2,'0'),d=String(date.getDate()).padStart(2,'0');return `${y}-${m}-${d}`}
function crm3848ClampMonth(date){const min=new Date(2026,6,1),max=new Date(2030,11,1);return date<min?min:date>max?max:date}
function crm3848FormatTime(v){return v?String(v).slice(0,5):''}
function crm3848EventTimeText(ev){const time=crm3848FormatTime(ev.start_time);return time?`${time} `:''}

async function crm3848LoadCalendar(){
  let q=state.client.from('calendar_events').select('*, owner:profiles!calendar_events_owner_id_fkey(full_name,office_name)').order('start_date',{ascending:true}).order('start_time',{ascending:true});
  if(!state.calendarShowAll)q=q.eq('owner_id',state.profile.id);
  const {data,error}=await q;
  if(error){toast(error.message);state.calendarEvents=[];return}
  state.calendarEvents=data||[];
}

async function crm3848RenderCalendar(){
  await crm3848LoadCalendar();
  const current=crm3848ClampMonth(new Date(state.calendarMonth+'T00:00:00'));
  state.calendarMonth=crm3848DateLocal(new Date(current.getFullYear(),current.getMonth(),1));
  const year=current.getFullYear(),month=current.getMonth();
  const first=new Date(year,month,1),start=new Date(year,month,1-first.getDay());
  const filtered=state.calendarEvents.filter(e=>state.calendarFilters.has(e.category));
  const cells=[];
  for(let i=0;i<42;i++){
    const date=new Date(start);date.setDate(start.getDate()+i);
    const ds=crm3848DateLocal(date),outside=date.getMonth()!==month;
    const events=filtered.filter(e=>e.start_date<=ds&&e.end_date>=ds);
    const visible=events.slice(0,4);
    cells.push(`<div class="calendar-day ${outside?'outside':''} ${ds===today()?'today':''}" onclick="crm3848OpenCalendarEvent(null,'${ds}')">
      <div class="calendar-day-head"><span class="calendar-day-number">${date.getDate()}</span><span class="calendar-day-add">＋</span></div>
      <div class="calendar-events">${visible.map(ev=>`<button type="button" class="calendar-event ${crm3848CategoryClass(ev.category)}" title="${escapeHtml(ev.title)}" onclick="event.stopPropagation();crm3848OpenCalendarEvent('${ev.id}')">${crm3848EventTimeText(ev)}${escapeHtml(ev.title)}${state.calendarShowAll&&ev.owner?.full_name?` · ${escapeHtml(ev.owner.full_name)}`:''}</button>`).join('')}${events.length>4?`<div class="calendar-more">+${events.length-4}개 더보기</div>`:''}</div>
    </div>`);
  }
  const canPrev=year>2026||month>6,canNext=year<2030||month<11;
  $('#content').innerHTML=`<div class="calendar-shell">
    <div class="panel calendar-toolbar">
      <div class="calendar-nav-group"><button class="ghost" onclick="crm3848MoveMonth(-1)" ${canPrev?'':'disabled'}>‹</button><button class="ghost" onclick="crm3848GoToday()">오늘</button><div class="calendar-month-title">${year}년 ${month+1}월</div><button class="ghost" onclick="crm3848MoveMonth(1)" ${canNext?'':'disabled'}>›</button></div>
      <div class="calendar-action-group"><button class="ghost calendar-view-toggle ${state.calendarShowAll?'active':''}" onclick="crm3848ToggleAll()">${state.calendarShowAll?'내 일정만 보기':'전체 일정 보기'}</button><button class="primary" onclick="crm3848OpenCalendarEvent(null,'${crm3848DateLocal(current)}')">+ 일정 등록</button></div>
    </div>
    <div class="panel calendar-filter-panel"><span class="calendar-filter-label">표시할 일정</span>${['계약일정','잔금일정','휴무일정','기타일정'].map(c=>`<label class="calendar-filter-item"><input type="checkbox" ${state.calendarFilters.has(c)?'checked':''} onchange="crm3848ToggleFilter('${c}',this.checked)"><span class="calendar-filter-dot ${crm3848CategoryClass(c)}"></span>${c}</label>`).join('')}<span class="calendar-legend-note">체크된 카테고리만 달력에 표시됩니다.</span></div>
    <div class="calendar-grid-wrap"><div class="calendar-grid">${['일','월','화','수','목','금','토'].map((d,i)=>`<div class="calendar-weekday ${i===0?'sun':i===6?'sat':''}">${d}</div>`).join('')}${cells.join('')}</div></div>
  </div>`;
}

function crm3848MoveMonth(delta){const d=new Date(state.calendarMonth+'T00:00:00');d.setMonth(d.getMonth()+delta);state.calendarMonth=crm3848DateLocal(crm3848ClampMonth(d));crm3848RenderCalendar()}
function crm3848GoToday(){const t=new Date();const clamped=crm3848ClampMonth(new Date(t.getFullYear(),t.getMonth(),1));state.calendarMonth=crm3848DateLocal(clamped);crm3848RenderCalendar()}
function crm3848ToggleAll(){state.calendarShowAll=!state.calendarShowAll;crm3848RenderCalendar()}
function crm3848ToggleFilter(category,checked){if(checked)state.calendarFilters.add(category);else state.calendarFilters.delete(category);crm3848RenderCalendar()}

async function crm3848OpenCalendarEvent(id=null,dateValue=''){
  let ev=id?state.calendarEvents.find(x=>x.id===id):null;
  if(id&&!ev){const {data,error}=await state.client.from('calendar_events').select('*, owner:profiles!calendar_events_owner_id_fkey(full_name,office_name)').eq('id',id).single();if(error)return toast(error.message);ev=data}
  const own=!ev||ev.owner_id===state.profile.id||state.profile.role==='admin';
  const baseDate=dateValue||ev?.start_date||today();
  if(baseDate<'2026-07-01'||baseDate>'2030-12-31')return toast('캘린더 일정은 2026년 7월부터 2030년 12월까지만 등록할 수 있습니다.');
  $('#modalTitle').textContent=ev?(own?'일정 수정':'일정 보기'):'일정 등록';
  $('#modalBody').innerHTML=own?`<div class="calendar-form-grid">
    <div class="span-2"><div class="calendar-category-grid">${['계약일정','잔금일정','휴무일정','기타일정'].map(c=>`<label class="calendar-category-choice"><input type="radio" name="calCategory" value="${c}" ${(ev?.category||'기타일정')===c?'checked':''}><span class="calendar-filter-dot ${crm3848CategoryClass(c)}"></span>${c}</label>`).join('')}</div></div>
    <label class="span-2">일정 제목<input id="calTitle" maxlength="100" value="${escapeHtml(ev?.title||'')}" placeholder="일정 제목을 입력하세요"></label>
    <label>시작일<input id="calStartDate" type="date" min="2026-07-01" max="2030-12-31" value="${ev?.start_date||baseDate}"></label>
    <label>종료일<input id="calEndDate" type="date" min="2026-07-01" max="2030-12-31" value="${ev?.end_date||baseDate}"></label>
    <label>시작 시간<input id="calStartTime" type="time" value="${crm3848FormatTime(ev?.start_time)}"></label>
    <label>종료 시간<input id="calEndTime" type="time" value="${crm3848FormatTime(ev?.end_time)}"></label>
    <label class="span-2">메모<textarea id="calDescription" rows="5" placeholder="장소, 상대방, 준비사항 등을 기록하세요.">${escapeHtml(ev?.description||'')}</textarea></label>
    ${ev?`<div class="span-2"><button type="button" class="danger" onclick="crm3848DeleteCalendarEvent('${ev.id}')">일정 삭제</button></div>`:''}
  </div>`:`<div class="calendar-readonly-box"><h3>${escapeHtml(ev.title)}</h3><p><strong>카테고리</strong> ${escapeHtml(ev.category)}</p><p><strong>기간</strong> ${fmtDate(ev.start_date)}${ev.end_date!==ev.start_date?` ~ ${fmtDate(ev.end_date)}`:''}</p>${ev.start_time?`<p><strong>시간</strong> ${crm3848FormatTime(ev.start_time)}${ev.end_time?` ~ ${crm3848FormatTime(ev.end_time)}`:''}</p>`:''}<p><strong>등록자</strong> ${escapeHtml(ev.owner?.full_name||'-')}</p>${ev.description?`<p><strong>메모</strong><br>${escapeHtml(ev.description).replace(/\n/g,'<br>')}</p>`:''}</div>`;
  $('#modalSubmit').style.display=own?'':'none';
  $('#modalSubmit').textContent=ev?'수정 저장':'일정 저장';
  $('#modalSubmit').onclick=own?async e=>{e.preventDefault();await crm3848SaveCalendarEvent(ev?.id||null)}:null;
  $('#modal').showModal();
}

async function crm3848SaveCalendarEvent(id){
  const title=$('#calTitle').value.trim(),category=document.querySelector('input[name="calCategory"]:checked')?.value,start=$('#calStartDate').value,end=$('#calEndDate').value;
  if(!title||!category||!start||!end)return toast('카테고리, 제목, 시작일과 종료일을 입력하세요.');
  if(start<'2026-07-01'||end>'2030-12-31'||end<start)return toast('일정 기간을 2026년 7월부터 2030년 12월 범위로 확인하세요.');
  const payload={owner_id:id?undefined:state.profile.id,category,title,description:$('#calDescription').value.trim()||null,start_date:start,end_date:end,start_time:$('#calStartTime').value||null,end_time:$('#calEndTime').value||null,updated_at:new Date().toISOString()};
  if(id)delete payload.owner_id;
  const {error}=id?await state.client.from('calendar_events').update(payload).eq('id',id):await state.client.from('calendar_events').insert(payload);
  if(error)return toast(error.message);
  $('#modal').close();toast(id?'일정을 수정했습니다.':'일정을 등록했습니다.');await crm3848RenderCalendar();
}
async function crm3848DeleteCalendarEvent(id){if(!confirm('이 일정을 삭제할까요?'))return;const {error}=await state.client.from('calendar_events').delete().eq('id',id);if(error)return toast(error.message);$('#modal').close();toast('일정을 삭제했습니다.');await crm3848RenderCalendar()}

const crm3848RenderListingTableBase=renderListingTable;
renderListingTable=function(rows,target,mine,adminMode=false){
  crm3848RenderListingTableBase(rows,target,mine,adminMode);
  const root=document.getElementById(target);
  root?.querySelectorAll('td.crm3843-col-title').forEach(td=>{
    if(td.querySelector('.crm3848-title-stack'))return;
    const link=td.querySelector('.crm3814-listing-title-link');
    const photo=td.querySelector('.photo-link');
    if(!link||!photo)return;
    const wrapper=document.createElement('div');wrapper.className='crm3848-title-stack';
    const badgeEl=td.querySelector('.badge');
    td.innerHTML='';wrapper.appendChild(link);if(badgeEl)wrapper.appendChild(badgeEl);wrapper.appendChild(photo);td.appendChild(wrapper);
  });
};

Object.assign(window,{renderView,crm3848RenderCalendar,crm3848MoveMonth,crm3848GoToday,crm3848ToggleAll,crm3848ToggleFilter,crm3848OpenCalendarEvent,crm3848SaveCalendarEvent,crm3848DeleteCalendarEvent,renderListingTable});
console.info('CRM v3.8.48 캘린더 및 매물명-내부사진 밀착 적용 완료');


/* ===== CRM v3.8.50 관리자 메뉴 순서 · 캘린더 전체관리/드래그 이동 ===== */
state.generalMenuOrder=[];
state.calendarDraggingId=null;
state.calendarEdgeTimer=null;
state.calendarSuppressClick=false;

const CRM3850_DEFAULT_MENU_ORDER=['dashboard','customers','myListings','network','calendar','smartMatch','globalSearch','documents'];

function crm3850MenuButtons(){
  return Array.from(document.querySelectorAll('#navMenu > button.nav:not(.admin-nav)'));
}
function crm3850ApplyMenuOrder(order){
  const nav=document.getElementById('navMenu');
  const adminSection=nav?.querySelector('.nav-section.admin-only');
  if(!nav||!adminSection)return;
  const buttons=crm3850MenuButtons();
  const map=new Map(buttons.map(b=>[b.dataset.view,b]));
  const normalized=[...(Array.isArray(order)?order:[]),...CRM3850_DEFAULT_MENU_ORDER].filter((v,i,a)=>a.indexOf(v)===i&&map.has(v));
  normalized.forEach(v=>nav.insertBefore(map.get(v),adminSection));
  state.generalMenuOrder=normalized;
  crm3850EnsureMenuOrderButton();
}
function crm3850EnsureMenuOrderButton(){
  const nav=document.getElementById('navMenu');
  if(!nav||state.profile?.role!=='admin')return;
  const label=nav.querySelector(':scope > .nav-section-label');
  if(!label||document.getElementById('generalMenuOrderBtn'))return;
  label.classList.add('crm3850-menu-label');
  const btn=document.createElement('button');
  btn.type='button';btn.id='generalMenuOrderBtn';btn.className='crm3850-menu-order-btn';btn.textContent='순서 변경';
  btn.onclick=crm3850OpenMenuOrder;
  label.appendChild(btn);
}
async function crm3850LoadMenuOrder(){
  try{
    const {data,error}=await state.client.from('app_settings').select('title').eq('setting_key','general_menu_order').maybeSingle();
    if(error)throw error;
    let order=[];
    try{order=JSON.parse(data?.title||'[]')}catch(_){order=[]}
    crm3850ApplyMenuOrder(order);
  }catch(e){
    console.warn('메뉴 순서 불러오기 실패',e);
    crm3850ApplyMenuOrder(CRM3850_DEFAULT_MENU_ORDER);
  }
}
function crm3850OpenMenuOrder(){
  if(state.profile?.role!=='admin')return toast('관리자만 메뉴 순서를 변경할 수 있습니다.');
  const buttons=crm3850MenuButtons();
  const labels=new Map(buttons.map(b=>[b.dataset.view,b.textContent.trim()]));
  const order=(state.generalMenuOrder.length?state.generalMenuOrder:CRM3850_DEFAULT_MENU_ORDER).filter(v=>labels.has(v));
  $('#modalTitle').textContent='일반 업무 메뉴 순서';
  $('#modalBody').innerHTML=`<div class="crm3850-menu-order-list">${order.map((v,i)=>`<div class="crm3850-menu-order-row" data-view="${v}"><span class="crm3850-order-number">${i+1}</span><strong>${escapeHtml(labels.get(v))}</strong><div class="crm3850-order-actions"><button type="button" class="ghost" onclick="crm3850MoveMenuRow(this,-1)" ${i===0?'disabled':''}>위</button><button type="button" class="ghost" onclick="crm3850MoveMenuRow(this,1)" ${i===order.length-1?'disabled':''}>아래</button></div></div>`).join('')}</div><p class="muted">저장하면 모든 중개사의 왼쪽 일반 업무 메뉴에 동일하게 적용됩니다.</p>`;
  $('#modalSubmit').style.display='';
  $('#modalSubmit').textContent='순서 저장';
  $('#modalSubmit').onclick=async e=>{e.preventDefault();await crm3850SaveMenuOrder()};
  $('#modal').showModal();
}
function crm3850RefreshMenuOrderRows(){
  const rows=Array.from(document.querySelectorAll('.crm3850-menu-order-row'));
  rows.forEach((row,i)=>{
    row.querySelector('.crm3850-order-number').textContent=String(i+1);
    const btns=row.querySelectorAll('button');
    btns[0].disabled=i===0;btns[1].disabled=i===rows.length-1;
  });
}
function crm3850MoveMenuRow(btn,delta){
  const row=btn.closest('.crm3850-menu-order-row'),list=row?.parentElement;if(!row||!list)return;
  if(delta<0&&row.previousElementSibling)list.insertBefore(row,row.previousElementSibling);
  if(delta>0&&row.nextElementSibling)list.insertBefore(row.nextElementSibling,row);
  crm3850RefreshMenuOrderRows();
}
async function crm3850SaveMenuOrder(){
  const order=Array.from(document.querySelectorAll('.crm3850-menu-order-row')).map(r=>r.dataset.view);
  const payload={setting_key:'general_menu_order',title:JSON.stringify(order),subtitle:'일반 업무 메뉴 순서',updated_by:state.profile.id,updated_at:new Date().toISOString()};
  const {error}=await state.client.from('app_settings').upsert(payload,{onConflict:'setting_key'});
  if(error)return toast(error.message);
  crm3850ApplyMenuOrder(order);$('#modal').close();toast('일반 업무 메뉴 순서를 저장했습니다.');
}

const crm3850LoadProfileBase=loadProfile;
loadProfile=async function(){
  await crm3850LoadProfileBase();
  if(state.profile?.status==='approved')await crm3850LoadMenuOrder();
};

function crm3850CanManageCalendarEvent(ev){return !!ev&&(ev.owner_id===state.profile.id||state.profile.role==='admin')}
function crm3850CalendarEventHtml(ev){
  const canMove=crm3850CanManageCalendarEvent(ev);
  return `<button type="button" class="calendar-event ${crm3848CategoryClass(ev.category)} ${canMove?'calendar-draggable':''}" title="${escapeHtml(ev.title)}${canMove?' · 드래그하여 이동':''}" ${canMove?'draggable="true"':''} data-event-id="${ev.id}" onclick="event.stopPropagation();if(!state.calendarSuppressClick)crm3848OpenCalendarEvent('${ev.id}')" ondragstart="crm3850CalendarDragStart(event,'${ev.id}')" ondragend="crm3850CalendarDragEnd(event)">${crm3848EventTimeText(ev)}${escapeHtml(ev.title)}${state.calendarShowAll&&ev.owner?.full_name?` · ${escapeHtml(ev.owner.full_name)}`:''}</button>`;
}

crm3848RenderCalendar=async function(){
  await crm3848LoadCalendar();
  const current=crm3848ClampMonth(new Date(state.calendarMonth+'T00:00:00'));
  state.calendarMonth=crm3848DateLocal(new Date(current.getFullYear(),current.getMonth(),1));
  const year=current.getFullYear(),month=current.getMonth();
  const first=new Date(year,month,1),start=new Date(year,month,1-first.getDay());
  const filtered=state.calendarEvents.filter(e=>state.calendarFilters.has(e.category));
  const cells=[];
  for(let i=0;i<42;i++){
    const date=new Date(start);date.setDate(start.getDate()+i);
    const ds=crm3848DateLocal(date),outside=date.getMonth()!==month;
    const events=filtered.filter(e=>e.start_date<=ds&&e.end_date>=ds);
    const visible=events.slice(0,4);
    cells.push(`<div class="calendar-day ${outside?'outside':''} ${ds===today()?'today':''}" data-date="${ds}" onclick="crm3848OpenCalendarEvent(null,'${ds}')" ondragover="crm3850CalendarDragOver(event)" ondragleave="crm3850CalendarDragLeave(event)" ondrop="crm3850CalendarDrop(event,'${ds}')">
      <div class="calendar-day-head"><span class="calendar-day-number">${date.getDate()}</span><span class="calendar-day-add">＋</span></div>
      <div class="calendar-events">${visible.map(crm3850CalendarEventHtml).join('')}${events.length>4?`<div class="calendar-more">+${events.length-4}개 더보기</div>`:''}</div>
    </div>`);
  }
  const canPrev=year>2026||month>6,canNext=year<2030||month<11;
  $('#content').innerHTML=`<div class="calendar-shell">
    <div class="panel calendar-toolbar">
      <div class="calendar-nav-group"><button class="ghost" onclick="crm3848MoveMonth(-1)" ${canPrev?'':'disabled'}>‹</button><button class="ghost" onclick="crm3848GoToday()">오늘</button><div class="calendar-month-title">${year}년 ${month+1}월</div><button class="ghost" onclick="crm3848MoveMonth(1)" ${canNext?'':'disabled'}>›</button></div>
      <div class="calendar-action-group">${state.profile.role==='admin'?'<span class="crm3850-admin-calendar-badge">관리자: 전체 일정 수정·삭제·이동 가능</span>':''}<button class="ghost calendar-view-toggle ${state.calendarShowAll?'active':''}" onclick="crm3848ToggleAll()">${state.calendarShowAll?'내 일정만 보기':'전체 일정 보기'}</button><button class="primary" onclick="crm3848OpenCalendarEvent(null,'${crm3848DateLocal(current)}')">+ 일정 등록</button></div>
    </div>
    <div class="panel calendar-filter-panel"><span class="calendar-filter-label">표시할 일정</span>${['계약일정','잔금일정','휴무일정','기타일정'].map(c=>`<label class="calendar-filter-item"><input type="checkbox" ${state.calendarFilters.has(c)?'checked':''} onchange="crm3848ToggleFilter('${c}',this.checked)"><span class="calendar-filter-dot ${crm3848CategoryClass(c)}"></span>${c}</label>`).join('')}<span class="calendar-legend-note">일정을 원하는 날짜로 끌어 옮길 수 있습니다.</span></div>
    <div class="calendar-grid-wrap crm3850-calendar-dnd-wrap">
      <div class="crm3850-edge-zone prev ${canPrev?'':'disabled'}" ondragenter="crm3850CalendarEdgeEnter(event,-1)" ondragover="event.preventDefault()" ondragleave="crm3850CalendarEdgeLeave(event)">‹ 이전 달</div>
      <div class="calendar-grid">${['일','월','화','수','목','금','토'].map((d,i)=>`<div class="calendar-weekday ${i===0?'sun':i===6?'sat':''}">${d}</div>`).join('')}${cells.join('')}</div>
      <div class="crm3850-edge-zone next ${canNext?'':'disabled'}" ondragenter="crm3850CalendarEdgeEnter(event,1)" ondragover="event.preventDefault()" ondragleave="crm3850CalendarEdgeLeave(event)">다음 달 ›</div>
    </div>
  </div>`;
};

function crm3850CalendarDragStart(event,id){
  const ev=state.calendarEvents.find(x=>x.id===id);
  if(!crm3850CanManageCalendarEvent(ev)){event.preventDefault();return}
  state.calendarDraggingId=id;state.calendarSuppressClick=true;
  event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',id);
  requestAnimationFrame(()=>document.body.classList.add('crm3850-calendar-dragging'));
}
function crm3850CalendarDragEnd(){
  clearTimeout(state.calendarEdgeTimer);state.calendarEdgeTimer=null;state.calendarDraggingId=null;
  document.body.classList.remove('crm3850-calendar-dragging');
  document.querySelectorAll('.calendar-day.drag-target').forEach(el=>el.classList.remove('drag-target'));
  setTimeout(()=>{state.calendarSuppressClick=false},120);
}
function crm3850CalendarDragOver(event){
  if(!state.calendarDraggingId)return;event.preventDefault();event.dataTransfer.dropEffect='move';
  event.currentTarget.classList.add('drag-target');
}
function crm3850CalendarDragLeave(event){event.currentTarget.classList.remove('drag-target')}
function crm3850DateDiffDays(a,b){return Math.round((new Date(b+'T12:00:00')-new Date(a+'T12:00:00'))/86400000)}
function crm3850AddDays(ds,days){const d=new Date(ds+'T12:00:00');d.setDate(d.getDate()+days);return crm3848DateLocal(d)}
async function crm3850CalendarDrop(event,targetDate){
  event.preventDefault();event.stopPropagation();event.currentTarget.classList.remove('drag-target');
  const id=state.calendarDraggingId||event.dataTransfer.getData('text/plain');
  const ev=state.calendarEvents.find(x=>x.id===id);if(!ev||!crm3850CanManageCalendarEvent(ev))return crm3850CalendarDragEnd();
  const delta=crm3850DateDiffDays(ev.start_date,targetDate);
  const newStart=crm3850AddDays(ev.start_date,delta),newEnd=crm3850AddDays(ev.end_date,delta);
  if(newStart<'2026-07-01'||newEnd>'2030-12-31'){toast('일정은 2026년 7월부터 2030년 12월까지만 이동할 수 있습니다.');return crm3850CalendarDragEnd()}
  const {error}=await state.client.from('calendar_events').update({start_date:newStart,end_date:newEnd,updated_at:new Date().toISOString()}).eq('id',id);
  if(error){toast(error.message);return crm3850CalendarDragEnd()}
  crm3850CalendarDragEnd();toast(`${fmtDate(newStart)}로 일정을 이동했습니다.`);await crm3848RenderCalendar();
}
function crm3850CalendarEdgeEnter(event,delta){
  event.preventDefault();if(!state.calendarDraggingId||event.currentTarget.classList.contains('disabled'))return;
  clearTimeout(state.calendarEdgeTimer);event.currentTarget.classList.add('edge-active');
  state.calendarEdgeTimer=setTimeout(async()=>{
    event.currentTarget?.classList.remove('edge-active');
    const d=new Date(state.calendarMonth+'T00:00:00');d.setMonth(d.getMonth()+delta);
    state.calendarMonth=crm3848DateLocal(crm3848ClampMonth(d));
    await crm3848RenderCalendar();
  },650);
}
function crm3850CalendarEdgeLeave(event){clearTimeout(state.calendarEdgeTimer);state.calendarEdgeTimer=null;event.currentTarget.classList.remove('edge-active')}

console.info('CRM v3.8.50 관리자 메뉴 순서 및 캘린더 드래그 이동 적용 완료');

/* ===== CRM v3.8.51 계약진행 일정 캘린더 가져오기 ===== */
function crm3851StripHtml(value){
  const div=document.createElement('div');div.innerHTML=String(value||'').replace(/<br\s*\/?>/gi,' · ');return (div.textContent||'').trim();
}
function crm3851StageDefinitions(listing){
  return [
    {key:'provisional',label:'가계약',date:listing.provisional_contract_date,amountLabel:'가계약금',amount:listing.provisional_contract_amount,category:'계약일정',completed:!!listing.provisional_contract_completed},
    {key:'contract',label:'본계약',date:listing.contract_date,amountLabel:'계약금',amount:listing.contract_amount,category:'계약일정',completed:!!listing.contract_completed},
    {key:'interim',label:'중도금',date:listing.interim_payment_date,amountLabel:'중도금',amount:listing.interim_payment_amount,category:'계약일정',completed:!!listing.interim_payment_completed,skip:!!listing.interim_payment_not_applicable},
    {key:'final',label:'잔금',date:listing.final_payment_date,amountLabel:'잔금',amount:listing.final_payment_amount,category:'잔금일정',completed:!!listing.final_payment_completed}
  ].filter(x=>x.date&&!x.skip&&x.date>='2026-07-01'&&x.date<='2030-12-31');
}
function crm3851ContractMarker(listingId,key){return `#CRM-CONTRACT:${listingId}:${key}`}
function crm3851StageStatus(stage){return stage.completed?'완료':'예정'}
function crm3851AllStageSummary(listing){
  return crm3851StageDefinitions(listing).map(s=>`• ${s.label}: ${fmtDate(s.date)}${s.amount!==null&&s.amount!==undefined&&s.amount!==''?` / ${s.amountLabel} ${fmtMoney(s.amount)}`:''} / ${crm3851StageStatus(s)}`).join('\n')||'• 등록된 계약 일정 없음';
}
function crm3851EventDescription(listing,stage){
  const broker=listing.owner?.full_name||state.profile.full_name||'-';
  const deal=crm38DealTypeText(listing)||listing.transaction_type||'-';
  const price=crm3851StripHtml(listingPriceText(listing))||'-';
  const customer=listing.counterparty_name||'-';
  const customerPhone=listing.counterparty_phone||'-';
  return [
    '[계약 일정 정보]',
    `단계: ${stage.label} (${crm3851StageStatus(stage)})`,
    `일정일: ${fmtDate(stage.date)}`,
    stage.amount!==null&&stage.amount!==undefined&&stage.amount!==''?`${stage.amountLabel}: ${fmtMoney(stage.amount)}`:'',
    `매물명: ${listing.title||'-'}`,
    `주소: ${listing.address||listing.district||'-'}`,
    `거래유형: ${deal}`,
    `거래조건: ${price}`,
    `거래 고객명: ${customer}`,
    `거래 고객 연락처: ${customerPhone}`,
    `담당 중개사: ${broker}`,
    '',
    '[전체 계약 진행 일정]',
    crm3851AllStageSummary(listing),
    '',
    crm3851ContractMarker(listing.id,stage.key)
  ].filter(v=>v!==''||v=== '').join('\n');
}
function crm3851EventPayload(listing,stage){
  const broker=listing.owner?.full_name||state.profile.full_name||'중개사';
  return {
    owner_id:state.profile.id,
    category:stage.category,
    title:`[${stage.label}] ${listing.title} ${broker}`,
    description:crm3851EventDescription(listing,stage),
    start_date:stage.date,
    end_date:stage.date,
    start_time:null,
    end_time:null,
    updated_at:new Date().toISOString()
  };
}
async function crm3851OpenContractImport(){
  await loadListings();
  const ownListings=state.listings.filter(x=>x.owner_id===state.profile.id);
  const candidates=[];
  ownListings.forEach(listing=>crm3851StageDefinitions(listing).forEach(stage=>candidates.push({listing,stage,marker:crm3851ContractMarker(listing.id,stage.key)})));
  const {data:existing,error}=await state.client.from('calendar_events').select('id,description,start_date,title').eq('owner_id',state.profile.id);
  if(error)return toast(error.message);
  const existingRows=existing||[];
  candidates.forEach(c=>{c.existing=existingRows.find(e=>String(e.description||'').includes(c.marker))||null});
  $('#modalTitle').textContent='계약 진행 일정 가져오기';
  $('#modalBody').innerHTML=candidates.length?`<div class="crm3851-import-help">내 매물의 가계약·본계약·중도금·잔금 날짜를 캘린더 일정으로 가져옵니다. 이미 가져온 일정은 현재 계약정보로 갱신됩니다.</div>
    <div class="crm3851-import-toolbar"><label class="inline-check"><input id="crm3851SelectAll" type="checkbox" onchange="crm3851ToggleAll(this.checked)"> 전체 선택</label><span>가져올 일정 ${candidates.length}건</span></div>
    <div class="crm3851-import-list">${candidates.map((c,i)=>`<label class="crm3851-import-row">
      <input type="checkbox" class="crm3851-import-check" data-index="${i}">
      <span class="crm3851-import-stage ${c.stage.category==='잔금일정'?'balance':'contract'}">${escapeHtml(c.stage.label)}</span>
      <span class="crm3851-import-main"><strong>${escapeHtml(c.listing.title)}</strong><small>${escapeHtml(c.listing.address||c.listing.district||'주소 미입력')} · ${fmtDate(c.stage.date)}${c.stage.amount!==null&&c.stage.amount!==undefined&&c.stage.amount!==''?` · ${escapeHtml(c.stage.amountLabel)} ${fmtMoney(c.stage.amount)}`:''}</small></span>
      <span class="crm3851-import-state">${c.existing?'기존 일정 갱신':'새 일정'}</span>
    </label>`).join('')}</div>`:'<div class="empty">내 매물에 등록된 계약 일정이 없습니다.<br><span class="muted">진행상황에서 가계약·본계약·중도금·잔금 날짜를 먼저 입력하세요.</span></div>';
  state.crm3851ImportCandidates=candidates;
  $('#modalSubmit').style.display=candidates.length?'':'none';
  $('#modalSubmit').textContent='선택 일정 가져오기';
  $('#modalSubmit').onclick=candidates.length?async e=>{e.preventDefault();await crm3851ImportSelected()}:null;
  const reset=()=>{$('#modalSubmit').style.display='';state.crm3851ImportCandidates=[];$('#modal').removeEventListener('close',reset)};
  $('#modal').addEventListener('close',reset);
  $('#modal').showModal();
}
function crm3851ToggleAll(checked){document.querySelectorAll('.crm3851-import-check').forEach(x=>x.checked=checked)}
async function crm3851ImportSelected(){
  const indexes=Array.from(document.querySelectorAll('.crm3851-import-check:checked')).map(x=>Number(x.dataset.index));
  if(!indexes.length)return toast('가져올 일정을 선택하세요.');
  const candidates=state.crm3851ImportCandidates||[];
  let created=0,updated=0;
  for(const idx of indexes){
    const c=candidates[idx];if(!c)continue;
    const payload=crm3851EventPayload(c.listing,c.stage);
    let error;
    if(c.existing){delete payload.owner_id;({error}=await state.client.from('calendar_events').update(payload).eq('id',c.existing.id));updated++}
    else {({error}=await state.client.from('calendar_events').insert(payload));created++}
    if(error)return toast(error.message);
  }
  $('#modal').close();
  toast(`계약 일정을 가져왔습니다. 신규 ${created}건 · 갱신 ${updated}건`);
  const first=(candidates[indexes[0]]?.stage.date)||state.calendarMonth;
  state.calendarMonth=first.slice(0,7)+'-01';
  await crm3848RenderCalendar();
}

const crm3851RenderCalendarBase=crm3848RenderCalendar;
crm3848RenderCalendar=async function(){
  await crm3851RenderCalendarBase();
  const actions=document.querySelector('.calendar-action-group');
  if(actions&&!actions.querySelector('.crm3851-contract-import-btn')){
    const btn=document.createElement('button');
    btn.type='button';btn.className='ghost crm3851-contract-import-btn';btn.textContent='계약일정 가져오기';btn.onclick=crm3851OpenContractImport;
    const register=actions.querySelector('.primary');actions.insertBefore(btn,register||null);
  }
};
console.info('CRM v3.8.51 계약진행 일정 캘린더 가져오기 적용 완료');

/* ===== CRM v3.8.52 주소·동·호 분리 및 중복매물 차단 ===== */
function crm3852Compact(value){return String(value??'').trim().replace(/\s+/g,'')}
function crm3852NormalizeBuilding(value){
  const v=crm3852Compact(value);
  if(!v)return '1동';
  if(/동$/.test(v))return v;
  return /^\d+$/.test(v)?`${v}동`:v;
}
function crm3852NormalizeUnit(value){
  const v=crm3852Compact(value);
  if(!v)return '';
  if(/호$/.test(v))return v;
  return /^\d+$/.test(v)?`${v}호`:v;
}
function crm3852AddressKey(value){return crm3852Compact(value).toLowerCase()}
function crm3852SplitLegacyAddress(value){
  let address=String(value||'').trim(),building='1동',unit='';
  const unitMatch=address.match(/(?:^|\s)([^\s]+호)$/);
  if(unitMatch){unit=crm3852NormalizeUnit(unitMatch[1]);address=address.slice(0,unitMatch.index).trim()}
  const buildingMatch=address.match(/(?:^|\s)([^\s]+동)$/);
  if(buildingMatch){building=crm3852NormalizeBuilding(buildingMatch[1]);address=address.slice(0,buildingMatch.index).trim()}
  return {address,building_no:building,unit_no:unit};
}
function crm3852FullAddress(listing){
  // 기존 주소 칸 끝에 호수가 함께 저장된 자료도 자동 분리해서
  // 항상 `지번주소 → 동 → 호수` 순서로 표시한다.
  const raw=String(listing?.address||listing?.district||'주소 미입력').trim();
  const legacy=crm3852SplitLegacyAddress(raw);
  const unit=crm3852NormalizeUnit(listing?.unit_no||legacy.unit_no||'');
  const building=crm3852NormalizeBuilding(listing?.building_no||legacy.building_no||'1동');
  const lot=unit && legacy.unit_no ? legacy.address : raw;
  return [lot,building,unit].filter(Boolean).join(' ');
}
async function crm3852FindDuplicate(address,building,unit,id){
  if(!address||!unit)return null;
  let q=state.client.from('listings').select('id,title,owner_id,owner:profiles!listings_owner_id_fkey(full_name)').eq('address_normalized',crm3852AddressKey(address)).eq('building_no',building).eq('unit_no',unit);
  if(id)q=q.neq('id',id);
  const {data,error}=await q.limit(1);
  if(error){console.warn('중복매물 조회 실패',error);return null}
  return data?.[0]||null;
}
const crm3852OpenListingModalBase=openListingModal;
openListingModal=function(id){
  crm3852OpenListingModalBase(id);
  const listing=id?state.listings.find(x=>x.id===id):null;
  const addressInput=document.querySelector('#modalBody [name="address"]');
  if(!addressInput)return;
  const oldLabel=addressInput.closest('label');
  const legacy=crm3852SplitLegacyAddress(listing?.address||addressInput.value||'');
  // 구조화된 호수가 없고 기존 주소 끝에 `603호`처럼 들어 있으면 자동 분리한다.
  const addressValue=listing?.unit_no?(listing.address||''):legacy.address;
  const buildingValue=listing?.building_no||legacy.building_no||'1동';
  const unitValue=listing?.unit_no||legacy.unit_no||'';
  const wrap=document.createElement('div');
  wrap.className='span-2 crm3852-address-row';
  wrap.innerHTML=`
    <label class="crm3852-address-main">주소(지번까지)<input name="address" value="${escapeHtml(addressValue)}" placeholder="예: 서울 양천구 신월동 52-13" required></label>
    <label>동<input name="building_no" value="${escapeHtml(buildingValue)}" placeholder="예: 101동"></label>
    <label>호수<input name="unit_no" value="${escapeHtml(unitValue)}" placeholder="예: 603호" required></label>
    <div class="crm3852-address-help">동이 없는 건물은 비워두면 자동으로 <strong>1동</strong>으로 저장됩니다.</div>`;
  oldLabel.replaceWith(wrap);

  const submit=document.getElementById('modalSubmit');
  const oldHandler=submit?.onclick;
  if(!submit||!oldHandler)return;
  submit.onclick=async function(e){
    e.preventDefault();
    const addressEl=document.querySelector('#modalBody [name="address"]');
    const buildingEl=document.querySelector('#modalBody [name="building_no"]');
    const unitEl=document.querySelector('#modalBody [name="unit_no"]');
    const address=String(addressEl?.value||'').trim().replace(/\s+/g,' ');
    const building=crm3852NormalizeBuilding(buildingEl?.value);
    const unit=crm3852NormalizeUnit(unitEl?.value);
    if(!address)return toast('주소를 지번까지 입력하세요.');
    if(!unit)return toast('호수를 입력하세요.');
    buildingEl.value=building;unitEl.value=unit;addressEl.value=address;
    const duplicate=await crm3852FindDuplicate(address,building,unit,id);
    if(duplicate){
      const broker=duplicate.owner?.full_name||'다른 중개사';
      alert(`이미 ${broker} 중개사가 접수한 매물입니다.\n\n${crm3852FullAddress({address,building_no:building,unit_no:unit})}\n매물명: ${duplicate.title||'-'}`);
      return;
    }
    const beforeIds=new Set((state.listings||[]).map(x=>x.id));
    await oldHandler.call(this,e);
    if(document.getElementById('modal')?.open)return;
    let listingId=id;
    if(!listingId){
      const {data}=await state.client.from('listings').select('id').eq('owner_id',state.profile.id).eq('address',address).order('created_at',{ascending:false}).limit(5);
      listingId=(data||[]).find(x=>!beforeIds.has(x.id))?.id||data?.[0]?.id;
    }
    if(!listingId)return;
    const {error}=await state.client.from('listings').update({address,building_no:building,unit_no:unit,address_normalized:crm3852AddressKey(address)}).eq('id',listingId);
    if(error){
      if(!id)await state.client.from('listings').delete().eq('id',listingId);
      alert(error.message.includes('duplicate_listing_address')?'동일한 주소·동·호수의 매물이 이미 등록되어 있어 저장할 수 없습니다.':`주소 정보 저장 실패: ${error.message}`);
      return;
    }
    await loadListings();
    if(state.view==='network')renderNetwork();else if(state.view==='adminListings')renderAdminListings();else renderMyListings();
  };
};

const crm3852RenderListingTableBase=renderListingTable;
renderListingTable=function(rows,target,mine,adminMode=false){
  crm3852RenderListingTableBase(rows,target,mine,adminMode);
  const table=document.querySelector(`#${target} table`);if(!table)return;
  const addressRows=[...table.querySelectorAll('tbody tr.crm3813-address-row')];
  addressRows.forEach((row,index)=>{
    const line=row.querySelector('.crm3829-address-line');
    const text=line?.querySelector('span:first-child');
    if(text&&rows[index]){const full=crm3852FullAddress(rows[index]);text.textContent=full;line.title=full}
  });
};

// 캘린더로 가져오는 계약 일정에도 분리된 전체 주소를 사용한다.
const crm3852EventDescriptionBase=typeof crm3851EventDescription==='function'?crm3851EventDescription:null;
if(crm3852EventDescriptionBase){
  crm3851EventDescription=function(listing,stage){
    return crm3852EventDescriptionBase(listing,stage).replace(`주소: ${listing.address||listing.district||'-'}`,`주소: ${crm3852FullAddress(listing)}`);
  };
}
Object.assign(window,{openListingModal,renderListingTable,crm3852FullAddress});
console.info('CRM v3.8.52 주소·동·호 분리 및 중복매물 차단 적용 완료');

/* ===== CRM v3.8.53 동·호수 표시 순서 보정 ===== */
console.info('CRM v3.8.53 주소 동·호수 순서 보정 적용 완료');

/* ===== CRM v3.8.54 등록일시 표시 · 거래유형 기준 중복매물 판정 ===== */
function crm3854AddressMatchKey(value){
  const compact=String(value||'').toLowerCase().replace(/서울특별시|서울시|서울/g,'').replace(/\s+/g,'');
  const m=compact.match(/([가-힣]+구)([가-힣0-9]+동)(산?\d+(?:-\d+)?)/);
  return m?`${m[1]}|${m[2]}|${m[3]}`:compact;
}
function crm3854BuildingSignature(value){
  const digits=String(value||'1').replace(/\D/g,'')||'1';
  return `${digits[0]}${digits[digits.length-1]}`;
}
function crm3854UnitKey(value){return String(value||'').replace(/\D/g,'')}
function crm3854SelectedDealTypes(){
  const cards=[...document.querySelectorAll('#modalBody .crm38-deal-card')];
  const selected=cards.filter(c=>c.querySelector('.crm38-deal-check')?.checked).map(c=>c.dataset.type).filter(Boolean);
  const fallback=document.querySelector('#modalBody [name="transaction_type"]')?.value;
  return [...new Set(selected.length?selected:(fallback?[fallback]:[]))];
}
function crm3854ListingDealTypes(listing){return [...new Set(crm38DealOptions(listing).map(o=>o.deal_type).filter(Boolean))]}
async function crm3854FindSameUnitListings(address,building,unit,id){
  if(!address||!unit)return [];
  const key=crm3854AddressMatchKey(address),bSig=crm3854BuildingSignature(building),uKey=crm3854UnitKey(unit);
  let q=state.client.from('listings').select('*, owner:profiles!listings_owner_id_fkey(full_name,office_name)');
  if(id)q=q.neq('id',id);
  const {data,error}=await q;
  if(error){console.warn('동일 호수 조회 실패',error);return []}
  const candidates=(data||[]).filter(x=>crm3854AddressMatchKey(x.address)===key&&crm3854BuildingSignature(x.building_no||'1동')===bSig&&crm3854UnitKey(x.unit_no)===uKey);
  if(!candidates.length)return [];
  const ids=candidates.map(x=>x.id);
  const {data:options}=await state.client.from('listing_deal_options').select('*').in('listing_id',ids);
  return candidates.map(x=>({...x,deal_options:(options||[]).filter(o=>o.listing_id===x.id)}));
}
function crm3854ExistingSummary(listing){
  const broker=listing.owner?.full_name||'다른 중개사';
  const office=listing.owner?.office_name?` (${listing.owner.office_name})`:'';
  const types=crm3854ListingDealTypes(listing).join('·')||listing.transaction_type||'-';
  return `${broker}${office} 중개사 · ${types} · ${listing.title||'매물명 없음'}`;
}

const crm3854OpenListingModalBase=openListingModal;
openListingModal=function(id){
  crm3854OpenListingModalBase(id);
  const submit=document.getElementById('modalSubmit');
  if(!submit||submit.dataset.crm3854Bound==='1')return;
  submit.dataset.crm3854Bound='1';
  const previous=submit.onclick;
  submit.onclick=async function(e){
    e.preventDefault();
    const address=String(document.querySelector('#modalBody [name="address"]')?.value||'').trim();
    const building=crm3852NormalizeBuilding(document.querySelector('#modalBody [name="building_no"]')?.value);
    const unit=crm3852NormalizeUnit(document.querySelector('#modalBody [name="unit_no"]')?.value);
    const newTypes=crm3854SelectedDealTypes();
    if(!id&&address&&unit&&newTypes.length){
      const same=await crm3854FindSameUnitListings(address,building,unit,null);
      const blocked=same.filter(x=>crm3854ListingDealTypes(x).some(t=>newTypes.includes(t)));
      if(blocked.length){
        const lines=blocked.map(crm3854ExistingSummary).join('\n');
        alert(`동일한 주소·동·호수에 같은 거래유형 매물이 이미 등록되어 있습니다.\n\n${lines}\n\n같은 거래유형은 중복 등록할 수 없습니다.`);
        return;
      }
      const other=same.filter(x=>!crm3854ListingDealTypes(x).some(t=>newTypes.includes(t)));
      if(other.length){
        const lines=other.map(crm3854ExistingSummary).join('\n');
        alert(`해당 호수에는 다른 거래유형의 매물이 이미 등록되어 있습니다.\n\n${lines}\n\n현재 선택한 거래유형(${newTypes.join('·')})은 달라서 계속 등록할 수 있습니다.`);
      }
    }
    return previous?.call(this,e);
  };
};

function crm3854CreatedAtText(value){
  if(!value)return '등록일시 -';
  const d=new Date(value);
  if(Number.isNaN(d.getTime()))return '등록일시 -';
  return `등록 ${d.toLocaleDateString('ko-KR',{year:'2-digit',month:'2-digit',day:'2-digit'})} ${d.toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',hour12:false})}`;
}
const crm3854RenderListingTableBase=renderListingTable;
renderListingTable=function(rows,target,mine,adminMode=false){
  crm3854RenderListingTableBase(rows,target,mine,adminMode);
  const root=document.getElementById(target),table=root?.querySelector('table');
  if(!table)return;
  const headers=[...table.querySelectorAll('thead th')];
  const manageIndex=headers.findIndex(th=>th.textContent.trim()==='관리');
  if(manageIndex<0)return;
  const dataRows=[...table.querySelectorAll('tbody tr:not(.crm3813-address-row)')];
  dataRows.forEach((tr,i)=>{
    const cell=tr.children[manageIndex],item=rows[i];
    if(!cell||!item||cell.querySelector('.crm3854-created-at'))return;
    const stamp=document.createElement('div');stamp.className='crm3854-created-at';stamp.textContent=crm3854CreatedAtText(item.created_at);
    const actions=cell.querySelector('.row-actions');cell.insertBefore(stamp,actions||cell.firstChild);
  });
};
Object.assign(window,{openListingModal,renderListingTable});
console.info('CRM v3.8.54 등록일시 및 거래유형 기준 중복매물 판정 적용 완료');

/* ===== CRM v3.8.55 구조화 주소키 · 확정/의심 중복매물 판정 ===== */
function crm3855OnlyDigits(value, fallback=''){
  const digits=String(value??'').replace(/[^0-9]/g,'').replace(/^0+(?=\d)/,'');
  return digits||fallback;
}
function crm3855ParseLotAddress(value){
  const display=String(value||'').trim().replace(/\s+/g,' ');
  const clean=display
    .replace(/서울특별시|서울시|서울/g,' ')
    .replace(/[(),]/g,' ')
    .replace(/번지/g,' ')
    .replace(/\s+/g,' ')
    .trim();
  const compact=clean.replace(/\s+/g,'');
  const district=(compact.match(/([가-힣]+구)/)||[])[1]||'';
  const afterDistrict=district?compact.slice(compact.indexOf(district)+district.length):compact;
  const dong=(afterDistrict.match(/([가-힣0-9]+(?:동|가|읍|면|리))/)||[])[1]||'';
  const afterDong=dong?afterDistrict.slice(afterDistrict.indexOf(dong)+dong.length):afterDistrict;
  const lotMatch=afterDong.match(/(산)?\s*(\d+)(?:\s*-\s*(\d+))?/);
  const mountain=!!lotMatch?.[1];
  const lotMain=lotMatch?.[2]||'';
  const lotSub=lotMatch?.[3]||'0';
  const fallback=compact.toLowerCase();
  return {
    display,
    district_key:district,
    legal_dong_key:dong,
    lot_main_key:lotMain?(mountain?`산${lotMain}`:lotMain):'',
    lot_sub_key:lotSub,
    fallback_key:fallback,
    parsed:!!(district&&dong&&lotMain)
  };
}
function crm3855CanonicalInput(address,building,unit){
  const p=crm3855ParseLotAddress(address);
  return {
    ...p,
    building_key:crm3855OnlyDigits(building,'1'),
    unit_key:crm3855OnlyDigits(unit,''),
  };
}
function crm3855CanonicalListing(listing){
  const parsed=crm3855ParseLotAddress(listing?.address||'');
  return {
    ...parsed,
    district_key:listing?.district_key||parsed.district_key,
    legal_dong_key:listing?.legal_dong_key||parsed.legal_dong_key,
    lot_main_key:listing?.lot_main_key||parsed.lot_main_key,
    lot_sub_key:String(listing?.lot_sub_key??parsed.lot_sub_key??'0'),
    building_key:String(listing?.building_key||crm3855OnlyDigits(listing?.building_no,'1')),
    unit_key:String(listing?.unit_key||crm3855OnlyDigits(listing?.unit_no,'')),
  };
}
function crm3855SameLotUnit(a,b){
  if(a.parsed&&b.parsed){
    return a.district_key===b.district_key&&a.legal_dong_key===b.legal_dong_key&&a.lot_main_key===b.lot_main_key&&String(a.lot_sub_key||'0')===String(b.lot_sub_key||'0')&&a.unit_key===b.unit_key;
  }
  return a.fallback_key===b.fallback_key&&a.unit_key===b.unit_key;
}
function crm3855BuildingLooksSimilar(a,b){
  const x=String(a||''),y=String(b||'');
  if(!x||!y||x===y)return false;
  // 1동/101동처럼 관행적으로 혼용될 가능성만 경고하고, 자동으로 동일 확정하지 않습니다.
  return (x==='1'&&y.endsWith('1'))||(y==='1'&&x.endsWith('1'));
}
async function crm3855FindCandidates(address,building,unit,id){
  const key=crm3855CanonicalInput(address,building,unit);
  if(!key.unit_key)return {key,rows:[]};
  let q=state.client.from('listings').select('*, owner:profiles!listings_owner_id_fkey(full_name,office_name)');
  if(id)q=q.neq('id',id);
  if(key.parsed){
    q=q.eq('district_key',key.district_key).eq('legal_dong_key',key.legal_dong_key).eq('lot_main_key',key.lot_main_key).eq('lot_sub_key',key.lot_sub_key).eq('unit_key',key.unit_key);
  }
  const {data,error}=await q;
  let candidates=[];
  if(error){
    // 새 SQL 적용 전에도 화면이 멈추지 않도록 기존 자료를 읽어 보조 비교합니다.
    console.warn('구조화 주소 조회 실패, 보조 비교 사용',error);
    const fallback=await state.client.from('listings').select('*, owner:profiles!listings_owner_id_fkey(full_name,office_name)');
    candidates=(fallback.data||[]).filter(x=>(!id||x.id!==id)&&crm3855SameLotUnit(key,crm3855CanonicalListing(x)));
  }else{
    candidates=(data||[]).filter(x=>crm3855SameLotUnit(key,crm3855CanonicalListing(x)));
  }
  if(!candidates.length)return {key,rows:[]};
  const ids=candidates.map(x=>x.id);
  const {data:options}=await state.client.from('listing_deal_options').select('*').in('listing_id',ids);
  return {key,rows:candidates.map(x=>({...x,deal_options:(options||[]).filter(o=>o.listing_id===x.id)}))};
}
function crm3855CandidateLine(x){
  const owner=x.owner?.full_name||'다른 중개사';
  const office=x.owner?.office_name?` (${x.owner.office_name})`:'';
  const types=crm3854ListingDealTypes(x).join('·')||x.transaction_type||'-';
  return `• ${owner}${office} / ${types} / ${x.title||'매물명 없음'}\n  ${crm3852FullAddress(x)}`;
}

// 하위 버전의 단순 문자열/첫·끝자리 중복검사는 v3.8.55 검사 완료 후 건너뜁니다.
let crm3855DuplicateCheckPassed=false;
crm3852FindDuplicate=async function(){return crm3855DuplicateCheckPassed?null:null};
crm3854FindSameUnitListings=async function(){return crm3855DuplicateCheckPassed?[]:[]};

const crm3855OpenListingModalBase=openListingModal;
openListingModal=function(id){
  crm3855OpenListingModalBase(id);
  const submit=document.getElementById('modalSubmit');
  if(!submit||submit.dataset.crm3855Bound==='1')return;
  submit.dataset.crm3855Bound='1';
  const previous=submit.onclick;
  submit.onclick=async function(e){
    e.preventDefault();
    const address=String(document.querySelector('#modalBody [name="address"]')?.value||'').trim();
    const building=crm3852NormalizeBuilding(document.querySelector('#modalBody [name="building_no"]')?.value);
    const unit=crm3852NormalizeUnit(document.querySelector('#modalBody [name="unit_no"]')?.value);
    const newTypes=crm3854SelectedDealTypes();
    if(!address||!unit||!newTypes.length)return previous?.call(this,e);

    const {key,rows}=await crm3855FindCandidates(address,building,unit,id);
    const exact=rows.filter(x=>crm3855CanonicalListing(x).building_key===key.building_key);
    const exactBlocked=exact.filter(x=>crm3854ListingDealTypes(x).some(t=>newTypes.includes(t)));
    if(exactBlocked.length){
      alert(`동일한 지번·동·호수에 같은 거래유형이 이미 등록되어 있습니다.\n\n${exactBlocked.map(crm3855CandidateLine).join('\n\n')}\n\n겹치는 거래유형은 중복 등록할 수 없습니다.`);
      return;
    }

    const exactOther=exact.filter(x=>!crm3854ListingDealTypes(x).some(t=>newTypes.includes(t)));
    if(exactOther.length){
      const ok=confirm(`동일한 호수에 다른 거래유형 매물이 있습니다.\n\n${exactOther.map(crm3855CandidateLine).join('\n\n')}\n\n새 거래유형(${newTypes.join('·')})은 겹치지 않습니다. 계속 등록하시겠습니까?`);
      if(!ok)return;
    }

    const suspicious=rows.filter(x=>{
      const old=crm3855CanonicalListing(x);
      return old.building_key!==key.building_key;
    });
    if(suspicious.length){
      const similar=suspicious.some(x=>crm3855BuildingLooksSimilar(crm3855CanonicalListing(x).building_key,key.building_key));
      const label=similar?'동 표기가 1동/101동처럼 혼용되었을 가능성이 있습니다.':'같은 지번·호수에 동 번호만 다른 매물이 있습니다.';
      const ok=confirm(`유사 중복매물이 발견되었습니다.\n${label}\n\n${suspicious.map(crm3855CandidateLine).join('\n\n')}\n\n실제로 다른 동인지 확인한 뒤 계속 등록하시겠습니까?`);
      if(!ok)return;
    }

    if(!key.parsed){
      const ok=confirm('주소에서 구·법정동·지번을 정확히 분리하지 못했습니다.\n예: 강서구 화곡동 1039-27 형식인지 확인해 주세요.\n\n그래도 저장하시겠습니까?');
      if(!ok)return;
    }

    crm3855DuplicateCheckPassed=true;
    try{return await previous?.call(this,e)}finally{crm3855DuplicateCheckPassed=false}
  };
};
Object.assign(window,{openListingModal,crm3855ParseLotAddress});
console.info('CRM v3.8.55 구조화 주소키 및 확정/의심 중복매물 판정 적용 완료');


/* ===== CRM v3.8.56 데이터베이스 중복 오류 사용자 안내 ===== */
window.addEventListener('unhandledrejection',function(event){
  const msg=String(event?.reason?.message||event?.reason||'');
  if(msg.includes('duplicate_listing_same_trade')){
    event.preventDefault();
    alert('동일한 주소·동·호수에 같은 거래유형 매물이 이미 등록되어 있습니다.\n\n기존 매물의 담당 중개사와 거래유형을 확인한 뒤 다른 거래유형으로 등록하거나 기존 매물을 이용해 주세요.');
  }
});
console.info('CRM v3.8.56 중복매물 데이터베이스 오류 안내 적용 완료');

/* ===== CRM v3.8.57 고객 상세·복수 거래유형·다중 연락처 개선 ===== */
const CRM3857_CUSTOMER_STATUSES=['신규인입','매물추천','방문','계약','보류','영업종료'];
const CRM3857_DEAL_TYPES=['매매','전세','월세'];
state.customerDealOptions=[];
state.customerContacts=[];

function crm3857DealOptions(customer){
  const rows=Array.isArray(customer?.deal_options)?customer.deal_options:[];
  if(rows.length)return CRM3857_DEAL_TYPES.map(t=>rows.find(r=>r.deal_type===t)).filter(Boolean);
  const types=String(customer?.deal_type||'').split('+').filter(t=>CRM3857_DEAL_TYPES.includes(t));
  return types.map((deal_type,i)=>({deal_type,budget_max:customer?.budget_max??null,desired_monthly_rent:deal_type==='월세'?customer?.desired_monthly_rent??null:null,is_preferred:i===0,sort_order:i}));
}
function crm3857Contacts(customer){
  const rows=Array.isArray(customer?.additional_contacts)?customer.additional_contacts:[];
  if(rows.length)return rows;
  return customer?.phone?[{contact_label:'본인',contact_name:customer.name||'',phone:customer.phone,sort_order:0}]:[];
}
function crm3857ContactHtml(customer){
  const rows=crm3857Contacts(customer);
  if(!rows.length)return '-';
  return `<div class="crm3857-contact-list">${rows.map(r=>`<div class="crm3857-contact-item"><strong>${escapeHtml(r.contact_label||'연락처')}${r.contact_name?` ${escapeHtml(r.contact_name)}`:''}</strong><span>${escapeHtml(crm381FormatPhone(r.phone||''))}</span></div>`).join('')}</div>`;
}
function crm3857DealText(customer){
  const opts=crm3857DealOptions(customer);
  return opts.length?opts.map(o=>o.deal_type).join(' · '):(customer?.deal_type||'-');
}
function crm3857BudgetText(customer){
  const opts=crm3857DealOptions(customer);
  if(!opts.length)return customerBudgetText(customer);
  return `<div class="crm3857-budget-list">${opts.map(o=>{
    if(o.deal_type==='월세')return `<div><strong>월세</strong> ${fmtMoney(o.budget_max)} / 월 ${fmtMoney(o.desired_monthly_rent)}</div>`;
    return `<div><strong>${escapeHtml(o.deal_type)}</strong> ${fmtMoney(o.budget_max)}</div>`;
  }).join('')}</div>`;
}

const crm3857LoadCustomersBase=loadCustomers;
loadCustomers=async function(){
  await crm3857LoadCustomersBase();
  const ids=(state.customers||[]).map(x=>x.id);
  if(!ids.length){state.customerDealOptions=[];state.customerContacts=[];return;}
  const [{data:dealRows,error:dealErr},{data:contactRows,error:contactErr}]=await Promise.all([
    state.client.from('customer_deal_options').select('*').in('customer_id',ids).order('sort_order'),
    state.client.from('customer_contacts').select('*').in('customer_id',ids).order('sort_order')
  ]);
  if(dealErr&&!String(dealErr.message||'').includes('does not exist'))console.warn(dealErr);
  if(contactErr&&!String(contactErr.message||'').includes('does not exist'))console.warn(contactErr);
  state.customerDealOptions=dealRows||[];
  state.customerContacts=contactRows||[];
  (state.customers||[]).forEach(c=>{
    c.deal_options=state.customerDealOptions.filter(x=>x.customer_id===c.id);
    c.additional_contacts=state.customerContacts.filter(x=>x.customer_id===c.id).map(x=>({...x,phone:crm381FormatPhone(x.phone)}));
    c.phone=crm381FormatPhone(c.phone||c.additional_contacts?.[0]?.phone||'');
  });
};

function crm3857AddContactRow(data={}){
  const wrap=document.getElementById('crm3857CustomerContacts');if(!wrap)return;
  const row=document.createElement('div');row.className='crm3857-customer-contact-row';
  row.innerHTML=`<input class="crm3857-contact-label" placeholder="구분 예: 본인, 배우자, 가족" value="${escapeHtml(data.contact_label||'')}"><input class="crm3857-contact-name" placeholder="이름" value="${escapeHtml(data.contact_name||'')}"><input class="crm3857-contact-phone" placeholder="010-0000-0000" value="${escapeHtml(crm381FormatPhone(data.phone||''))}"><button type="button" class="danger" onclick="this.closest('.crm3857-customer-contact-row').remove()">삭제</button>`;
  wrap.appendChild(row);
}
function crm3857ToggleDeal(type,checked){
  const panel=document.querySelector(`.crm3857-customer-deal-panel[data-type="${type}"]`);
  if(panel)panel.hidden=!checked;
}
function crm3857ReadDealOptions(){
  return CRM3857_DEAL_TYPES.flatMap((type,index)=>{
    const checked=document.querySelector(`.crm3857-customer-deal-check[value="${type}"]`)?.checked;
    if(!checked)return [];
    const panel=document.querySelector(`.crm3857-customer-deal-panel[data-type="${type}"]`);
    const budget=Number(panel?.querySelector('.crm3857-budget')?.value||0)||null;
    const rent=type==='월세'?(Number(panel?.querySelector('.crm3857-rent')?.value||0)||null):null;
    return [{deal_type:type,budget_max:budget,desired_monthly_rent:rent,is_preferred:index===CRM3857_DEAL_TYPES.findIndex(t=>document.querySelector(`.crm3857-customer-deal-check[value="${t}"]`)?.checked),sort_order:index}];
  });
}
function crm3857ReadContacts(){
  return [...document.querySelectorAll('.crm3857-customer-contact-row')].map((row,index)=>({
    contact_label:row.querySelector('.crm3857-contact-label')?.value.trim()||'연락처',
    contact_name:row.querySelector('.crm3857-contact-name')?.value.trim()||null,
    phone:crm381FormatPhone(row.querySelector('.crm3857-contact-phone')?.value||''),sort_order:index
  })).filter(x=>x.phone);
}

openCustomerModal=function(id=null){
  const x=id?(state.customers.find(v=>v.id===id)||{}):{};
  const opts=crm3857DealOptions(x),contacts=crm3857Contacts(x);
  $('#modalTitle').textContent=id?`${x.name||'고객'} · 고객 상세정보`:'고객 등록';
  $('#modalBody').innerHTML=`
  <div class="crm3857-customer-detail">
    <section class="crm3857-form-card crm3859-contact-first"><div class="crm3857-card-title"><div><h3>연락처</h3><p>구분·이름·전화번호를 여러 개 등록할 수 있습니다.</p></div><button type="button" class="primary" onclick="crm3857AddContactRow()">+ 번호 추가</button></div><div id="crm3857CustomerContacts" class="crm3857-customer-contacts"></div></section>
    <section class="crm3857-form-card"><h3>기본 정보</h3><div class="form-grid">
      <label>고객명<input name="name" value="${escapeHtml(x.name||'')}" required></label>
      <label>고객 구분<select name="customer_type"><option>매수</option><option>임차</option></select></label>
      <label>상태<select name="status">${CRM3857_CUSTOMER_STATUSES.map(s=>`<option>${s}</option>`).join('')}</select></label>
      <label>고객등급<select name="customer_grade"><option>A</option><option>B</option><option>C</option><option>D</option></select></label>
      <label>희망 지역<input name="preferred_area" value="${escapeHtml(x.preferred_area||'')}"></label>
      <label>희망 방개수<div class="inline-field"><input id="desiredRoomsInput" name="desired_rooms" type="number" min="0" step="1" value="${x.desired_rooms??''}" placeholder="예: 3"><label class="inline-check"><input id="desiredOnePointFiveCheck" type="checkbox" ${x.desired_one_point_five_room?'checked':''}> 1.5룸</label></div></label>
      <label>대출 여부<select name="loan_available"><option value="true">O</option><option value="false">X</option></select></label>
      <label>자기자본금(만원)<div class="inline-field"><input id="equityCapitalInput" name="equity_capital" type="number" min="0" value="${x.equity_capital??''}"><label class="inline-check"><input id="equityUnknownCheck" type="checkbox" ${x.equity_unknown?'checked':''}> 모름</label></div></label>
      <label>예정 FU<input name="next_follow_up_at" type="date" value="${x.next_follow_up_at?String(x.next_follow_up_at).slice(0,10):''}"></label>
    </div></section>
    <section class="crm3857-form-card crm3859-deal-card"><h3>희망 거래유형 및 금액</h3><p class="muted">여러 거래유형을 선택하면 유형별 희망금액을 각각 입력할 수 있습니다.</p><div class="crm3857-deal-checks">${CRM3857_DEAL_TYPES.map(type=>`<label class="crm3857-deal-check-card"><input type="checkbox" class="crm3857-customer-deal-check" value="${type}" ${opts.some(o=>o.deal_type===type)?'checked':''} onchange="crm3857ToggleDeal('${type}',this.checked)"> ${type}</label>`).join('')}</div><div class="crm3857-deal-panels">${CRM3857_DEAL_TYPES.map(type=>{const o=opts.find(v=>v.deal_type===type)||{};return `<div class="crm3857-customer-deal-panel" data-type="${type}" ${opts.some(v=>v.deal_type===type)?'':'hidden'}><strong>${type}</strong><label>${type==='월세'?'희망 보증금':'희망금액'}(만원)<input class="crm3857-budget" type="number" min="0" value="${o.budget_max??''}"></label>${type==='월세'?`<label>희망 월세(만원)<input class="crm3857-rent" type="number" min="0" value="${o.desired_monthly_rent??''}"></label>`:''}</div>`}).join('')}</div></section>
    <section class="crm3857-form-card"><label>상담 메모<textarea name="notes" rows="5">${escapeHtml(x.notes||'')}</textarea></label></section>
  </div>`;
  const form=$('#modalForm');
  form.querySelector('[name=customer_type]').value=['매수','임차'].includes(x.customer_type)?x.customer_type:'매수';
  form.querySelector('[name=status]').value=CRM3857_CUSTOMER_STATUSES.includes(x.status)?x.status:'신규인입';
  form.querySelector('[name=customer_grade]').value=x.customer_grade||'C';
  form.querySelector('[name=loan_available]').value=x.loan_available===false?'false':'true';
  (contacts.length?contacts:[{contact_label:'본인',contact_name:x.name||'',phone:x.phone||''}]).forEach(crm3857AddContactRow);
  const room=$('#desiredRoomsInput'),room15=$('#desiredOnePointFiveCheck');const syncRoom=()=>{room.disabled=room15.checked;if(room15.checked)room.value='1'};room15.onchange=syncRoom;syncRoom();
  const equity=$('#equityCapitalInput'),unknown=$('#equityUnknownCheck');const syncEq=()=>{equity.disabled=unknown.checked;if(unknown.checked)equity.value=''};unknown.onchange=syncEq;syncEq();
  $('#modalSubmit').style.display='';
  $('#modalSubmit').onclick=async e=>{
    e.preventDefault();
    const fd=new FormData(form),deals=crm3857ReadDealOptions(),contactList=crm3857ReadContacts();
    if(!fd.get('name')?.trim())return toast('고객명을 입력하세요.');
    if(!contactList.length)return toast('연락처를 한 개 이상 입력하세요.');
    if(!deals.length)return toast('거래유형을 한 개 이상 선택하세요.');
    const joined=deals.map(o=>o.deal_type).join('+'),primary=deals[0];
    const payload={owner_id:id?(x.owner_id||state.profile.id):state.profile.id,name:fd.get('name').trim(),phone:contactList[0].phone,customer_type:fd.get('customer_type'),status:fd.get('status'),customer_grade:fd.get('customer_grade')||'C',deal_type:joined,preferred_area:fd.get('preferred_area')||null,desired_rooms:room15.checked?1:(fd.get('desired_rooms')?Number(fd.get('desired_rooms')):null),desired_one_point_five_room:room15.checked,budget_max:primary?.budget_max??null,desired_monthly_rent:deals.find(o=>o.deal_type==='월세')?.desired_monthly_rent??null,loan_available:fd.get('loan_available')==='true',equity_unknown:unknown.checked,equity_capital:unknown.checked?null:(fd.get('equity_capital')?Number(fd.get('equity_capital')):null),next_follow_up_at:fd.get('next_follow_up_at')||null,notes:fd.get('notes')||null};
    let customerId=id;
    if(id){const {error}=await state.client.from('customers').update(payload).eq('id',id);if(error)return toast(error.message)}else{const {data,error}=await state.client.from('customers').insert(payload).select('id').single();if(error)return toast(error.message);customerId=data.id}
    const [{error:dDel},{error:cDel}]=await Promise.all([state.client.from('customer_deal_options').delete().eq('customer_id',customerId),state.client.from('customer_contacts').delete().eq('customer_id',customerId)]);
    if(dDel||cDel)return toast((dDel||cDel).message);
    const dealInsert=deals.map(o=>({...o,customer_id:customerId}));
    const contactInsert=contactList.map(o=>({...o,customer_id:customerId}));
    const [{error:dErr},{error:cErr}]=await Promise.all([state.client.from('customer_deal_options').insert(dealInsert),state.client.from('customer_contacts').insert(contactInsert)]);
    if(dErr||cErr)return toast((dErr||cErr).message);
    $('#modal').close();toast('고객정보를 저장했습니다.');await loadCustomers();renderCustomers();
  };
  $('#modal').showModal();
  setTimeout(()=>document.getElementById('contractCancelBtn')?.remove(),0);
};

renderCustomers=async function(){
  await loadCustomers();
  $('#topActions').innerHTML='<button class="primary" onclick="openCustomerModal()">+ 고객 등록</button>';
  $('#content').innerHTML=`<div class="panel"><div class="filters customer-filters"><input id="customerSearch" placeholder="이름·연락처 검색" oninput="filterCustomers()"><select id="customerType" onchange="filterCustomers()"><option value="">전체 구분</option><option>매수</option><option>임차</option></select><select id="customerStatus" onchange="filterCustomers()"><option value="">전체 상태</option>${CRM3857_CUSTOMER_STATUSES.map(s=>`<option>${s}</option>`).join('')}</select><select id="customerDealType" onchange="filterCustomers()"><option value="">전체 거래유형</option>${CRM3857_DEAL_TYPES.map(t=>`<option>${t}</option>`).join('')}</select><select id="customerGrade" onchange="filterCustomers()"><option value="">전체 등급</option><option>A</option><option>B</option><option>C</option><option>D</option></select></div><div id="customerTable"></div></div>`;
  filterCustomers();crm37AddQuickActions?.();
};
filterCustomers=function(){
  const q=($('#customerSearch')?.value||'').toLowerCase().replace(/\s/g,''),t=$('#customerType')?.value||'',s=$('#customerStatus')?.value||'',d=$('#customerDealType')?.value||'',g=$('#customerGrade')?.value||'';
  const rows=state.customers.filter(x=>{
    const search=`${x.name||''} ${x.phone||''} ${crm3857Contacts(x).map(c=>`${c.contact_label||''} ${c.contact_name||''} ${c.phone||''}`).join(' ')}`.toLowerCase().replace(/\s/g,'');
    return (!q||search.includes(q))&&(!t||x.customer_type===t)&&(!s||x.status===s)&&(!d||crm3857DealOptions(x).some(o=>o.deal_type===d))&&(!g||x.customer_grade===g);
  });
  $('#customerTable').innerHTML=rows.length?`<div class="table-wrap"><table class="customer-table crm3857-customer-table"><thead><tr><th>순번</th><th>고객명</th><th>연락처</th><th>상태</th><th>구분</th><th>거래유형</th><th>등급</th><th>희망지역</th><th>방</th><th>희망금액</th><th>진행상황</th><th>최종 FU</th><th>예정 FU</th><th>관리</th></tr></thead><tbody>${rows.map((x,i)=>`<tr><td>${i+1}</td><td><button class="crm3857-customer-name" onclick="openCustomerModal('${x.id}')">${escapeHtml(x.name)}</button></td><td>${crm3857ContactHtml(x)}</td><td>${badge(x.status||'신규인입','blue')}</td><td>${escapeHtml(x.customer_type||'-')}</td><td>${escapeHtml(crm3857DealText(x))}</td><td>${gradeBadge(x.customer_grade)}</td><td>${escapeHtml(x.preferred_area||'-')}</td><td>${customerRoomText(x)}</td><td>${crm3857BudgetText(x)}</td><td>${contractStage(x)}</td><td>${fmtDate(x.last_follow_up_at)}</td><td>${dueBadge(x.next_follow_up_at)}</td><td><div class="row-actions"><button class="success" onclick="openFollowUpModal('customer','${x.id}')">FU</button><button class="ghost" onclick="openHistoryModal('customer','${x.id}')">히스토리</button><button class="ghost" onclick="openContractModal('customer','${x.id}')">진행상황</button><button class="ghost" onclick="openCustomerModal('${x.id}')">수정</button><button class="danger" onclick="deleteCustomer('${x.id}')">삭제</button></div></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">조건에 맞는 고객이 없습니다.</div>';
};

const crm3857FollowBase=openFollowUpModal;
openFollowUpModal=async function(...args){const result=await crm3857FollowBase(...args);setTimeout(()=>document.getElementById('contractCancelBtn')?.remove(),0);return result};
const crm3857HistoryBase=openHistoryModal;
openHistoryModal=async function(...args){const result=await crm3857HistoryBase(...args);setTimeout(()=>document.getElementById('contractCancelBtn')?.remove(),0);return result};

Object.assign(window,{openCustomerModal,renderCustomers,filterCustomers,loadCustomers,crm3857AddContactRow,crm3857ToggleDeal,openFollowUpModal,openHistoryModal});
console.info('CRM v3.8.59 고객시트 정렬·UI·진행취소 이력 완료');

/* ===== CRM v3.8.61 고객시트 순서·간편 거래UI·주소검색/동호 선택 ===== */
filterCustomers=function(){
  const q=($('#customerSearch')?.value||'').toLowerCase().replace(/\s/g,''),t=$('#customerType')?.value||'',s=$('#customerStatus')?.value||'',d=$('#customerDealType')?.value||'',g=$('#customerGrade')?.value||'';
  const rows=state.customers.filter(x=>{
    const search=`${x.name||''} ${x.phone||''} ${crm3857Contacts(x).map(c=>`${c.contact_label||''} ${c.contact_name||''} ${c.phone||''}`).join(' ')}`.toLowerCase().replace(/\s/g,'');
    return (!q||search.includes(q))&&(!t||x.customer_type===t)&&(!s||x.status===s)&&(!d||crm3857DealOptions(x).some(o=>o.deal_type===d))&&(!g||x.customer_grade===g);
  });
  $('#customerTable').innerHTML=rows.length?`<div class="table-wrap"><table class="customer-table crm3857-customer-table crm3861-customer-table"><thead><tr><th>순번</th><th>상태</th><th>고객명</th><th>연락처</th><th>구분</th><th>거래유형</th><th>등급</th><th>희망지역</th><th>방</th><th>희망금액</th><th>진행상황</th><th>최종 FU</th><th>예정 FU</th><th>관리</th></tr></thead><tbody>${rows.map((x,i)=>`<tr><td>${i+1}</td><td>${badge(x.status||'신규인입','blue')}</td><td><button class="crm3857-customer-name" onclick="openCustomerModal('${x.id}')">${escapeHtml(x.name)}</button></td><td>${crm3857ContactHtml(x)}</td><td>${escapeHtml(x.customer_type||'-')}</td><td>${escapeHtml(crm3857DealText(x))}</td><td>${gradeBadge(x.customer_grade)}</td><td>${escapeHtml(x.preferred_area||'-')}</td><td>${customerRoomText(x)}</td><td>${crm3857BudgetText(x)}</td><td>${contractStage(x)}</td><td>${fmtDate(x.last_follow_up_at)}</td><td>${dueBadge(x.next_follow_up_at)}</td><td><div class="row-actions"><button class="success" onclick="openFollowUpModal('customer','${x.id}')">FU</button><button class="ghost" onclick="openHistoryModal('customer','${x.id}')">히스토리</button><button class="ghost" onclick="openContractModal('customer','${x.id}')">진행상황</button><button class="ghost" onclick="openCustomerModal('${x.id}')">수정</button><button class="danger" onclick="deleteCustomer('${x.id}')">삭제</button></div></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">조건에 맞는 고객이 없습니다.</div>';
};

function crm3861AddressLotKey(address){
  const p=crm3855ParseLotAddress(address||'');
  return p.parsed?`${p.district_key}|${p.legal_dong_key}|${p.lot_main_key}|${p.lot_sub_key}`:String(address||'').replace(/\s+/g,'').toLowerCase();
}
function crm3861ExistingAddressValues(address){
  const key=crm3861AddressLotKey(address);
  return (state.listings||[]).filter(x=>crm3861AddressLotKey(x.address)===key);
}
function crm3861SetHiddenValue(input,value){
  input.value=value||'';
  input.dispatchEvent(new Event('change',{bubbles:true}));
}
function crm3861BuildSelect(labelText,hiddenInput,values,current,placeholder,normalize){
  const shell=document.createElement('div');
  shell.className='crm3861-address-choice';
  const label=document.createElement('span');label.className='crm3861-mini-label';label.textContent=labelText;
  const select=document.createElement('select');
  const uniq=[...new Set(values.map(normalize).filter(Boolean))];
  select.innerHTML=`<option value="">${placeholder}</option>${uniq.map(v=>`<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('')}<option value="__manual__">직접 입력</option>`;
  const manual=document.createElement('input');manual.placeholder=labelText==='동'?'예: 101동':'예: 603호';manual.className='crm3861-manual-value';
  const normalizedCurrent=normalize(current||'');
  if(normalizedCurrent&&uniq.includes(normalizedCurrent)){select.value=normalizedCurrent;manual.hidden=true;crm3861SetHiddenValue(hiddenInput,normalizedCurrent)}
  else if(normalizedCurrent){select.value='__manual__';manual.value=normalizedCurrent;manual.hidden=false;crm3861SetHiddenValue(hiddenInput,normalizedCurrent)}
  else if(!uniq.length){select.value='__manual__';manual.hidden=false}
  else manual.hidden=true;
  const sync=()=>{
    const manualMode=select.value==='__manual__';manual.hidden=!manualMode;
    crm3861SetHiddenValue(hiddenInput,manualMode?normalize(manual.value):select.value);
  };
  select.onchange=sync;manual.oninput=sync;
  shell.append(label,select,manual);
  return {shell,select,manual,refresh(nextValues,nextCurrent){
    const next=[...new Set(nextValues.map(normalize).filter(Boolean))];
    select.innerHTML=`<option value="">${placeholder}</option>${next.map(v=>`<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('')}<option value="__manual__">직접 입력</option>`;
    const cur=normalize(nextCurrent||hiddenInput.value||'');
    if(cur&&next.includes(cur)){select.value=cur;manual.hidden=true;crm3861SetHiddenValue(hiddenInput,cur)}
    else if(cur){select.value='__manual__';manual.value=cur;manual.hidden=false;crm3861SetHiddenValue(hiddenInput,cur)}
    else if(!next.length){select.value='__manual__';manual.hidden=false;crm3861SetHiddenValue(hiddenInput,'')}
    else{select.value='';manual.hidden=true;crm3861SetHiddenValue(hiddenInput,'')}
  }};
}
function crm3861OpenPostcode(addressInput,onDone){
  if(!window.daum?.Postcode){toast('주소검색 모듈을 불러오지 못했습니다. 잠시 후 다시 시도하세요.');return;}
  new daum.Postcode({oncomplete(data){
    const selected=(data.jibunAddress||data.autoJibunAddress||data.roadAddress||'').trim();
    addressInput.value=selected;
    addressInput.dispatchEvent(new Event('change',{bubbles:true}));
    onDone?.(selected,data);
  }}).open();
}
function crm3861EnhanceListingAddress(){
  const row=document.querySelector('#modalBody .crm3852-address-row');
  const addressInput=row?.querySelector('[name="address"]');
  const buildingInput=row?.querySelector('[name="building_no"]');
  const unitInput=row?.querySelector('[name="unit_no"]');
  if(!row||!addressInput||!buildingInput||!unitInput||row.dataset.crm3861==='1')return;
  row.dataset.crm3861='1';
  const initialBuilding=buildingInput.value,initialUnit=unitInput.value;
  addressInput.readOnly=true;
  addressInput.placeholder='주소 검색 버튼을 눌러 지번주소를 선택하세요';
  const mainLabel=addressInput.closest('label');
  mainLabel.classList.add('crm3861-address-search-label');
  const line=document.createElement('div');line.className='crm3861-address-search-line';
  addressInput.parentNode.insertBefore(line,addressInput);line.appendChild(addressInput);
  const searchBtn=document.createElement('button');searchBtn.type='button';searchBtn.className='primary crm3861-address-search-btn';searchBtn.textContent='주소 검색';line.appendChild(searchBtn);

  const buildingLabel=buildingInput.closest('label'),unitLabel=unitInput.closest('label');
  buildingInput.type='hidden';unitInput.type='hidden';
  buildingLabel.style.display='none';unitLabel.style.display='none';
  const choiceWrap=document.createElement('div');choiceWrap.className='crm3861-building-unit-wrap';
  row.insertBefore(choiceWrap,row.querySelector('.crm3852-address-help'));
  let same=crm3861ExistingAddressValues(addressInput.value);
  const buildingChoice=crm3861BuildSelect('동',buildingInput,same.map(x=>x.building_no),initialBuilding,'동 선택',crm3852NormalizeBuilding);
  const unitsForBuilding=()=>same.filter(x=>crm3852NormalizeBuilding(x.building_no)===crm3852NormalizeBuilding(buildingInput.value||'1동')).map(x=>x.unit_no);
  const unitChoice=crm3861BuildSelect('호수',unitInput,unitsForBuilding(),initialUnit,'호수 선택',crm3852NormalizeUnit);
  choiceWrap.append(buildingChoice.shell,unitChoice.shell);
  const refresh=()=>{
    same=crm3861ExistingAddressValues(addressInput.value);
    buildingChoice.refresh(same.map(x=>x.building_no),buildingInput.value||initialBuilding);
    unitChoice.refresh(unitsForBuilding(),unitInput.value||initialUnit);
  };
  buildingChoice.select.addEventListener('change',()=>unitChoice.refresh(unitsForBuilding(),unitInput.value));
  buildingChoice.manual.addEventListener('input',()=>unitChoice.refresh(unitsForBuilding(),unitInput.value));
  searchBtn.onclick=()=>crm3861OpenPostcode(addressInput,(selected,data)=>{
    const region=document.querySelector('#modalBody [name="district"]');
    if(region&&data?.sigungu&&data?.bname)region.value=`${data.sigungu} ${data.bname}`;
    crm3861SetHiddenValue(buildingInput,'');crm3861SetHiddenValue(unitInput,'');
    refresh();
  });
  const help=row.querySelector('.crm3852-address-help');
  if(help)help.innerHTML='주소는 검색 결과에서 선택합니다. 기존 등록 자료가 있으면 동·호수가 선택 목록으로 표시되며, 목록에 없을 때만 <strong>직접 입력</strong>을 선택하세요.';
}
const crm3861OpenListingModalBase=openListingModal;
openListingModal=function(id){
  const result=crm3861OpenListingModalBase(id);
  setTimeout(crm3861EnhanceListingAddress,0);
  return result;
};
Object.assign(window,{filterCustomers,openListingModal,crm3861OpenPostcode});
console.info('CRM v3.8.61 고객시트 순서·간편 거래UI·주소검색/동호 선택 적용 완료');

/* ===== CRM v3.8.62 동·호수 단순 직접입력 ===== */
function crm3862AlphaNumericOnly(value){
  return String(value||'').replace(/[^0-9A-Za-z]/g,'').slice(0,12);
}
function crm3862EnhanceListingAddress(){
  const row=document.querySelector('#modalBody .crm3852-address-row');
  const addressInput=row?.querySelector('[name="address"]');
  const buildingInput=row?.querySelector('[name="building_no"]');
  const unitInput=row?.querySelector('[name="unit_no"]');
  if(!row||!addressInput||!buildingInput||!unitInput||row.dataset.crm3862==='1')return;
  row.dataset.crm3862='1';
  row.classList.add('crm3862-address-row');

  // v3.8.61에서 만든 동·호수 선택 UI 제거
  row.querySelector('.crm3861-building-unit-wrap')?.remove();

  const addressLabel=addressInput.closest('label');
  const buildingLabel=buildingInput.closest('label');
  const unitLabel=unitInput.closest('label');
  if(addressLabel){
    addressLabel.classList.remove('crm3861-address-search-label');
    addressLabel.classList.add('crm3862-address-label');
  }

  [buildingLabel,unitLabel].forEach(label=>{
    if(label){
      label.style.display='grid';
      label.classList.add('crm3862-unit-label');
    }
  });

  buildingInput.type='text';
  unitInput.type='text';
  buildingInput.inputMode='text';
  unitInput.inputMode='text';
  buildingInput.autocomplete='off';
  unitInput.autocomplete='off';
  buildingInput.placeholder='예: 101 또는 A';
  unitInput.placeholder='예: 603 또는 B1';
  buildingInput.value=crm3862AlphaNumericOnly(String(buildingInput.value||'').replace(/동$/,''));
  unitInput.value=crm3862AlphaNumericOnly(String(unitInput.value||'').replace(/호$/,''));

  const sanitize=e=>{
    const next=crm3862AlphaNumericOnly(e.target.value);
    if(e.target.value!==next)e.target.value=next;
  };
  buildingInput.addEventListener('input',sanitize);
  unitInput.addEventListener('input',sanitize);

  // 기존 주소검색 버튼의 동·호수 선택 연동 제거 후 단순 주소검색으로 교체
  const oldBtn=row.querySelector('.crm3861-address-search-btn');
  if(oldBtn){
    const newBtn=oldBtn.cloneNode(true);
    oldBtn.replaceWith(newBtn);
    newBtn.onclick=()=>crm3861OpenPostcode(addressInput,(selected,data)=>{
      const region=document.querySelector('#modalBody [name="district"]');
      if(region&&data?.sigungu&&data?.bname)region.value=`${data.sigungu} ${data.bname}`;
      buildingInput.value='';
      unitInput.value='';
      buildingInput.focus();
    });
  }

  const help=row.querySelector('.crm3852-address-help');
  if(help)help.textContent='주소는 검색 결과에서 선택하고, 동·호수는 숫자 또는 영문만 직접 입력하세요. 숫자만 입력하면 저장 시 동·호가 자동으로 붙습니다.';
}
const crm3862OpenListingModalBase=openListingModal;
openListingModal=function(id){
  const result=crm3862OpenListingModalBase(id);
  setTimeout(crm3862EnhanceListingAddress,20);
  return result;
};
Object.assign(window,{openListingModal});
console.info('CRM v3.8.62 주소검색 + 동호수 직접입력 적용 완료');

/* ===== CRM v3.8.63 1동·101동 동번호 표기 통합 중복판정 ===== */
function crm3863AlphaNumericKey(value, fallback=''){
  const raw=String(value??'').toUpperCase().replace(/동|호수|호/g,'').replace(/[^0-9A-Z]/g,'');
  if(!raw)return fallback;
  if(/^\d+$/.test(raw)){
    const normalized=raw.replace(/^0+(?=\d)/,'')||'0';
    return normalized;
  }
  return raw;
}
function crm3863BuildingKey(value){
  const key=crm3863AlphaNumericKey(value,'1');
  if(/^10[1-9]$/.test(key))return String(Number(key)-100);
  return key;
}
function crm3863UnitKey(value){
  return crm3863AlphaNumericKey(value,'');
}
crm3855CanonicalInput=function(address,building,unit){
  const p=crm3855ParseLotAddress(address);
  return {...p,building_key:crm3863BuildingKey(building),unit_key:crm3863UnitKey(unit)};
};
crm3855CanonicalListing=function(listing){
  const parsed=crm3855ParseLotAddress(listing?.address||'');
  return {
    ...parsed,
    district_key:listing?.district_key||parsed.district_key,
    legal_dong_key:listing?.legal_dong_key||parsed.legal_dong_key,
    lot_main_key:listing?.lot_main_key||parsed.lot_main_key,
    lot_sub_key:String(listing?.lot_sub_key??parsed.lot_sub_key??'0'),
    building_key:crm3863BuildingKey(listing?.building_no||listing?.building_key||'1'),
    unit_key:crm3863UnitKey(listing?.unit_no||listing?.unit_key||''),
  };
};
crm3855BuildingLooksSimilar=function(a,b){return crm3863BuildingKey(a)===crm3863BuildingKey(b)};
Object.assign(window,{crm3863BuildingKey,crm3863UnitKey});
console.info('CRM v3.8.63 1동·101동 표기 통합 중복판정 적용 완료');

/* ===== CRM v3.8.64 고객 희망 매물특징 · 매물 필터 연동 ===== */
const CRM3864_FEATURES=['반지하','옥탑','1층','엘리베이터','주차','반려동물 가능'];
function crm3864CustomerFeatures(customer){
  return Array.isArray(customer?.desired_feature_tags)?customer.desired_feature_tags:[];
}
function crm3864FeatureText(customer){
  const tags=crm3864CustomerFeatures(customer);
  return tags.length?`<div class="crm3864-feature-tags">${tags.map(t=>`<span>${escapeHtml(t)}</span>`).join('')}</div>`:'-';
}
function crm3864ReadCustomerFeatures(){
  return [...document.querySelectorAll('.crm3864-customer-feature:checked')].map(x=>x.value);
}

openCustomerModal=function(id=null){
  const x=id?(state.customers.find(v=>v.id===id)||{}):{};
  const opts=crm3857DealOptions(x),contacts=crm3857Contacts(x),selectedFeatures=new Set(crm3864CustomerFeatures(x));
  $('#modalTitle').textContent=id?`${x.name||'고객'} · 고객 상세정보`:'고객 등록';
  $('#modalBody').innerHTML=`
  <div class="crm3857-customer-detail">
    <section class="crm3857-form-card crm3859-contact-first"><div class="crm3857-card-title"><div><h3>연락처</h3><p>구분·이름·전화번호를 여러 개 등록할 수 있습니다.</p></div><button type="button" class="primary" onclick="crm3857AddContactRow()">+ 번호 추가</button></div><div id="crm3857CustomerContacts" class="crm3857-customer-contacts"></div></section>
    <section class="crm3857-form-card"><h3>기본 정보</h3><div class="form-grid">
      <label>고객명<input name="name" value="${escapeHtml(x.name||'')}" required></label>
      <label>고객 구분<select name="customer_type"><option>매수</option><option>임차</option></select></label>
      <label>상태<select name="status">${CRM3857_CUSTOMER_STATUSES.map(s=>`<option>${s}</option>`).join('')}</select></label>
      <label>고객등급<select name="customer_grade"><option>A</option><option>B</option><option>C</option><option>D</option></select></label>
      <label>희망 지역<input name="preferred_area" value="${escapeHtml(x.preferred_area||'')}"></label>
      <label>희망 방개수<div class="inline-field"><input id="desiredRoomsInput" name="desired_rooms" type="number" min="0" step="1" value="${x.desired_rooms??''}" placeholder="예: 3"><label class="inline-check"><input id="desiredOnePointFiveCheck" type="checkbox" ${x.desired_one_point_five_room?'checked':''}> 1.5룸</label></div></label>
      <label>대출 여부<select name="loan_available"><option value="true">O</option><option value="false">X</option></select></label>
      <label>자기자본금(만원)<div class="inline-field"><input id="equityCapitalInput" name="equity_capital" type="number" min="0" value="${x.equity_capital??''}"><label class="inline-check"><input id="equityUnknownCheck" type="checkbox" ${x.equity_unknown?'checked':''}> 모름</label></div></label>
      <label>예정 FU<input name="next_follow_up_at" type="date" value="${x.next_follow_up_at?String(x.next_follow_up_at).slice(0,10):''}"></label>
    </div></section>
    <section class="crm3857-form-card crm3859-deal-card"><h3>희망 거래유형 및 금액</h3><p class="muted">여러 거래유형을 선택하면 유형별 희망금액을 각각 입력할 수 있습니다.</p><div class="crm3857-deal-checks">${CRM3857_DEAL_TYPES.map(type=>`<label class="crm3857-deal-check-card"><input type="checkbox" class="crm3857-customer-deal-check" value="${type}" ${opts.some(o=>o.deal_type===type)?'checked':''} onchange="crm3857ToggleDeal('${type}',this.checked)"> ${type}</label>`).join('')}</div><div class="crm3857-deal-panels">${CRM3857_DEAL_TYPES.map(type=>{const o=opts.find(v=>v.deal_type===type)||{};return `<div class="crm3857-customer-deal-panel" data-type="${type}" ${opts.some(v=>v.deal_type===type)?'':'hidden'}><strong>${type}</strong><label>${type==='월세'?'희망 보증금':'희망금액'}(만원)<input class="crm3857-budget" type="number" min="0" value="${o.budget_max??''}"></label>${type==='월세'?`<label>희망 월세(만원)<input class="crm3857-rent" type="number" min="0" value="${o.desired_monthly_rent??''}"></label>`:''}</div>`}).join('')}</div></section>
    <section class="crm3857-form-card crm3864-feature-card"><h3>희망 매물 특징</h3><p class="muted">고객이 반드시 원하는 특징을 체크하세요. 자동추천과 매물 필터에 반영됩니다.</p><div class="crm3864-feature-grid">${CRM3864_FEATURES.map(tag=>`<label><input type="checkbox" class="crm3864-customer-feature" value="${tag}" ${selectedFeatures.has(tag)?'checked':''}> <span>${tag}</span></label>`).join('')}</div></section>
    <section class="crm3857-form-card"><label>상담 메모<textarea name="notes" rows="5">${escapeHtml(x.notes||'')}</textarea></label></section>
  </div>`;
  const form=$('#modalForm');
  form.querySelector('[name=customer_type]').value=['매수','임차'].includes(x.customer_type)?x.customer_type:'매수';
  form.querySelector('[name=status]').value=CRM3857_CUSTOMER_STATUSES.includes(x.status)?x.status:'신규인입';
  form.querySelector('[name=customer_grade]').value=x.customer_grade||'C';
  form.querySelector('[name=loan_available]').value=x.loan_available===false?'false':'true';
  (contacts.length?contacts:[{contact_label:'본인',contact_name:x.name||'',phone:x.phone||''}]).forEach(crm3857AddContactRow);
  const room=$('#desiredRoomsInput'),room15=$('#desiredOnePointFiveCheck');const syncRoom=()=>{room.disabled=room15.checked;if(room15.checked)room.value='1'};room15.onchange=syncRoom;syncRoom();
  const equity=$('#equityCapitalInput'),unknown=$('#equityUnknownCheck');const syncEq=()=>{equity.disabled=unknown.checked;if(unknown.checked)equity.value=''};unknown.onchange=syncEq;syncEq();
  $('#modalSubmit').style.display='';
  $('#modalSubmit').onclick=async e=>{
    e.preventDefault();
    const fd=new FormData(form),deals=crm3857ReadDealOptions(),contactList=crm3857ReadContacts(),desiredFeatures=crm3864ReadCustomerFeatures();
    if(!fd.get('name')?.trim())return toast('고객명을 입력하세요.');
    if(!contactList.length)return toast('연락처를 한 개 이상 입력하세요.');
    if(!deals.length)return toast('거래유형을 한 개 이상 선택하세요.');
    const joined=deals.map(o=>o.deal_type).join('+'),primary=deals[0];
    const payload={owner_id:id?(x.owner_id||state.profile.id):state.profile.id,name:fd.get('name').trim(),phone:contactList[0].phone,customer_type:fd.get('customer_type'),status:fd.get('status'),customer_grade:fd.get('customer_grade')||'C',deal_type:joined,preferred_area:fd.get('preferred_area')||null,desired_rooms:room15.checked?1:(fd.get('desired_rooms')?Number(fd.get('desired_rooms')):null),desired_one_point_five_room:room15.checked,budget_max:primary?.budget_max??null,desired_monthly_rent:deals.find(o=>o.deal_type==='월세')?.desired_monthly_rent??null,loan_available:fd.get('loan_available')==='true',equity_unknown:unknown.checked,equity_capital:unknown.checked?null:(fd.get('equity_capital')?Number(fd.get('equity_capital')):null),next_follow_up_at:fd.get('next_follow_up_at')||null,notes:fd.get('notes')||null,desired_feature_tags:desiredFeatures};
    let customerId=id;
    if(id){const {error}=await state.client.from('customers').update(payload).eq('id',id);if(error)return toast(error.message)}else{const {data,error}=await state.client.from('customers').insert(payload).select('id').single();if(error)return toast(error.message);customerId=data.id}
    const [{error:dDel},{error:cDel}]=await Promise.all([state.client.from('customer_deal_options').delete().eq('customer_id',customerId),state.client.from('customer_contacts').delete().eq('customer_id',customerId)]);
    if(dDel||cDel){
      const err=dDel||cDel;
      if(/customer_deal_options|customer_contacts|schema cache/i.test(err.message||'')) return toast('고객 거래유형·연락처 테이블이 아직 설치되지 않았습니다. v3.8.65 SQL을 Supabase에서 먼저 실행해 주세요.');
      return toast(err.message);
    }
    const [{error:dErr},{error:cErr}]=await Promise.all([state.client.from('customer_deal_options').insert(deals.map(o=>({...o,customer_id:customerId}))),state.client.from('customer_contacts').insert(contactList.map(o=>({...o,customer_id:customerId})))]);
    if(dErr||cErr){
      const err=dErr||cErr;
      if(/customer_deal_options|customer_contacts|schema cache/i.test(err.message||'')) return toast('고객 거래유형·연락처 테이블이 아직 설치되지 않았습니다. v3.8.65 SQL을 Supabase에서 먼저 실행해 주세요.');
      return toast(err.message);
    }
    $('#modal').close();toast('고객정보를 저장했습니다.');await loadCustomers();renderCustomers();
  };
  $('#modal').showModal();
  setTimeout(()=>document.getElementById('contractCancelBtn')?.remove(),0);
};

filterCustomers=function(){
  const q=($('#customerSearch')?.value||'').toLowerCase().replace(/\s/g,''),t=$('#customerType')?.value||'',s=$('#customerStatus')?.value||'',d=$('#customerDealType')?.value||'',g=$('#customerGrade')?.value||'';
  const rows=state.customers.filter(x=>{const search=`${x.name||''} ${x.phone||''} ${crm3857Contacts(x).map(c=>`${c.contact_label||''} ${c.contact_name||''} ${c.phone||''}`).join(' ')}`.toLowerCase().replace(/\s/g,'');return (!q||search.includes(q))&&(!t||x.customer_type===t)&&(!s||x.status===s)&&(!d||crm3857DealOptions(x).some(o=>o.deal_type===d))&&(!g||x.customer_grade===g)});
  $('#customerTable').innerHTML=rows.length?`<div class="table-wrap"><table class="customer-table crm3857-customer-table crm3861-customer-table"><thead><tr><th>순번</th><th>상태</th><th>고객명</th><th>연락처</th><th>구분</th><th>거래유형</th><th>등급</th><th>희망지역</th><th>방</th><th>희망금액</th><th>희망특징</th><th>진행상황</th><th>최종 FU</th><th>예정 FU</th><th>관리</th></tr></thead><tbody>${rows.map((x,i)=>`<tr><td>${i+1}</td><td>${badge(x.status||'신규인입','blue')}</td><td><button class="crm3857-customer-name" onclick="openCustomerModal('${x.id}')">${escapeHtml(x.name)}</button></td><td>${crm3857ContactHtml(x)}</td><td>${escapeHtml(x.customer_type||'-')}</td><td>${escapeHtml(crm3857DealText(x))}</td><td>${gradeBadge(x.customer_grade)}</td><td>${escapeHtml(x.preferred_area||'-')}</td><td>${customerRoomText(x)}</td><td>${crm3857BudgetText(x)}</td><td>${crm3864FeatureText(x)}</td><td>${contractStage(x)}</td><td>${fmtDate(x.last_follow_up_at)}</td><td>${dueBadge(x.next_follow_up_at)}</td><td><div class="row-actions"><button class="success" onclick="openFollowUpModal('customer','${x.id}')">FU</button><button class="ghost" onclick="openHistoryModal('customer','${x.id}')">히스토리</button><button class="ghost" onclick="openContractModal('customer','${x.id}')">진행상황</button><button class="ghost" onclick="openCustomerModal('${x.id}')">수정</button><button class="danger" onclick="deleteCustomer('${x.id}')">삭제</button></div></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">조건에 맞는 고객이 없습니다.</div>';
};

const crm3864FilterBarBase=crm3826FilterBar;
crm3826FilterBar=function(prefix){
  const handler=prefix==='myListing'?'filterMyListings()':'filterNetwork()';
  return `${crm3864FilterBarBase(prefix)}<div class="crm3864-listing-feature-filter"><strong>매물 특징</strong>${CRM3864_FEATURES.map(tag=>`<label><input type="checkbox" class="crm3864-listing-feature-check" data-prefix="${prefix}" value="${tag}" onchange="${handler}"> ${tag}</label>`).join('')}<button type="button" class="ghost" onclick="crm3864ClearListingFeatures('${prefix}')">초기화</button></div>`;
};
function crm3864SelectedListingFeatures(prefix){return [...document.querySelectorAll(`.crm3864-listing-feature-check[data-prefix="${prefix}"]:checked`)].map(x=>x.value)}
function crm3864ClearListingFeatures(prefix){document.querySelectorAll(`.crm3864-listing-feature-check[data-prefix="${prefix}"]`).forEach(x=>x.checked=false);prefix==='myListing'?filterMyListings():filterNetwork()}
const crm3864FilterRowsBase=crm3826FilterRows;
crm3826FilterRows=function(source,prefix){
  const rows=crm3864FilterRowsBase(source,prefix),features=crm3864SelectedListingFeatures(prefix);
  if(!features.length)return rows;
  return rows.filter(x=>{const tags=new Set(crm36Array(x.feature_tags));return features.every(tag=>tags.has(tag))});
};

const crm3864EvaluateBase=evaluateListingMatch;
evaluateListingMatch=function(customer,listing){
  const base=crm3864EvaluateBase(customer,listing),wanted=crm3864CustomerFeatures(customer);
  if(!wanted.length)return base;
  const tags=new Set(crm36Array(listing.feature_tags)),missing=wanted.filter(tag=>!tags.has(tag));
  if(missing.length)return {...base,matched:false,reasons:[...(base.reasons||[]),`희망 특징 미충족: ${missing.join(', ')}`]};
  return {...base,reasons:[...(base.reasons||[]),`희망 특징 충족: ${wanted.join(', ')}`]};
};

Object.assign(window,{openCustomerModal,filterCustomers,crm3864ClearListingFeatures});
console.info('CRM v3.8.64 고객 희망 매물특징 및 매물필터 연동 적용 완료');

console.info('CRM v3.8.65 고객 테이블 설치 오류 안내 및 스키마 보완 적용 완료');

/* ===== CRM v3.8.66 공동매물망 지도 보기 ===== */
state.networkMapMode = false;
state.networkMap = null;
state.networkMapCluster = null;
state.networkMapRenderToken = 0;

function crm3866CompactMoney(value){
  const n=Number(value||0);
  if(!n)return '-';
  if(n>=10000){
    const eok=Math.floor(n/10000), rem=n%10000;
    if(!rem)return `${eok}억`;
    const cheon=Math.floor(rem/1000), rest=rem%1000;
    return `${eok}억${cheon?`${cheon}천`:''}${rest?rest.toLocaleString():''}`;
  }
  return n.toLocaleString();
}
function crm3866PreferredDeal(listing){
  const opts=crm38DealOptions(listing);
  return opts.find(o=>o.is_preferred)||opts[0]||{deal_type:listing.transaction_type||'매매',price:listing.price,monthly_rent:listing.monthly_rent};
}
function crm3866MapPrice(listing){
  const o=crm3866PreferredDeal(listing);
  return o.deal_type==='월세'?`${crm3866CompactMoney(o.price)}/${crm3866CompactMoney(o.monthly_rent)}`:crm3866CompactMoney(o.price);
}
function crm3866FullAddress(listing){
  const parts=[listing.address,listing.building_no,listing.unit_no].map(v=>String(v||'').trim()).filter(Boolean);
  return parts.join(' ').replace(/\s+/g,' ').trim();
}
function crm3866MapMarkerHtml(listing){
  const o=crm3866PreferredDeal(listing);
  return `<div class="crm3866-map-pin"><span>${escapeHtml(o.deal_type||'매물')}</span><strong>${escapeHtml(crm3866MapPrice(listing))}</strong></div>`;
}
function crm3866MapPopup(listing){
  const owner=listing.owner?.full_name||listing.owner_name||'-';
  return `<div class="crm3866-map-popup">
    <strong>${escapeHtml(listing.title||'매물')}</strong>
    <div>${escapeHtml(crm3866FullAddress(listing)||listing.district||'주소 미입력')}</div>
    <div class="crm3866-map-popup-price">${listingPriceText(listing)}</div>
    <div class="muted">${escapeHtml(listing.property_type||'-')} · 담당 ${escapeHtml(owner)}</div>
    <button type="button" onclick="openListingModal('${listing.id}')">상세보기</button>
  </div>`;
}
function crm3866GeocodeCache(){
  try{return JSON.parse(localStorage.getItem('crm3866_geocode_cache')||'{}')}catch{return{}}
}
function crm3866SaveGeocodeCache(cache){
  try{localStorage.setItem('crm3866_geocode_cache',JSON.stringify(cache))}catch{}
}
function crm3866GeocodeKey(address){return String(address||'').toLowerCase().replace(/서울특별시|서울시/g,'서울').replace(/\s+/g,'').trim()}
async function crm3866GeocodeAddress(address){
  const key=crm3866GeocodeKey(address),cache=crm3866GeocodeCache();
  if(cache[key])return cache[key];
  const query=String(address||'').replace(/\s+\d+(동|호)$/g,'').trim();
  if(!query)return null;
  const url=`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=kr&accept-language=ko&q=${encodeURIComponent(query)}`;
  try{
    const res=await fetch(url,{headers:{Accept:'application/json'}});
    if(!res.ok)return null;
    const data=await res.json();
    if(!data?.length)return null;
    const result={lat:Number(data[0].lat),lng:Number(data[0].lon)};
    if(Number.isFinite(result.lat)&&Number.isFinite(result.lng)){cache[key]=result;crm3866SaveGeocodeCache(cache);return result}
  }catch(e){console.warn('주소 좌표 변환 실패',address,e)}
  return null;
}
async function crm3866PersistCoordinates(id,lat,lng){
  try{await state.client.rpc('set_listing_coordinates',{p_listing_id:id,p_lat:lat,p_lng:lng})}catch(e){console.warn(e)}
}
function crm3866MapIcon(listing){
  return L.divIcon({className:'crm3866-map-pin-wrap',html:crm3866MapMarkerHtml(listing),iconSize:[86,42],iconAnchor:[43,42],popupAnchor:[0,-38]});
}
function crm3866ClusterIcon(cluster){
  const count=cluster.getChildCount();
  return L.divIcon({html:`<div class="crm3866-map-cluster">${count}</div>`,className:'crm3866-map-cluster-wrap',iconSize:[46,46]});
}
function crm3866AddMapMarker(listing,bounds){
  const lat=Number(listing.latitude),lng=Number(listing.longitude);
  if(!Number.isFinite(lat)||!Number.isFinite(lng))return false;
  const marker=L.marker([lat,lng],{icon:crm3866MapIcon(listing),title:listing.title||'매물'}).bindPopup(crm3866MapPopup(listing),{maxWidth:330});
  state.networkMapCluster.addLayer(marker);bounds.push([lat,lng]);return true;
}
async function crm3866RenderMap(rows){
  const token=++state.networkMapRenderToken;
  const mapEl=document.getElementById('networkMap');if(!mapEl||!window.L)return;
  if(state.networkMap){state.networkMap.remove();state.networkMap=null}
  state.networkMap=L.map(mapEl,{zoomControl:true,minZoom:6,maxZoom:19,preferCanvas:true}).setView([37.5665,126.9780],11);

  // 일부 브라우저/보안 확장 프로그램에서 특정 지도 타일 서버가 차단될 수 있어
  // 순서대로 다른 지도 서버로 자동 전환한다.
  const tileProviders=[
    {name:'OpenStreetMap',url:'https://tile.openstreetmap.org/{z}/{x}/{y}.png',opts:{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}},
    {name:'Carto',url:'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',opts:{maxZoom:20,subdomains:'abcd',attribution:'&copy; OpenStreetMap contributors &copy; CARTO'}},
    {name:'Esri',url:'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',opts:{maxZoom:19,attribution:'Tiles &copy; Esri'}}
  ];
  let providerIndex=0,tileErrors=0,tileLoaded=false,activeTileLayer=null;
  const loadTileProvider=()=>{
    if(activeTileLayer){try{state.networkMap.removeLayer(activeTileLayer)}catch{}}
    const provider=tileProviders[providerIndex];
    tileErrors=0; tileLoaded=false;
    activeTileLayer=L.tileLayer(provider.url,{...provider.opts,keepBuffer:4,updateWhenIdle:false});
    activeTileLayer.on('tileload',()=>{tileLoaded=true});
    activeTileLayer.on('tileerror',()=>{
      tileErrors++;
      if(!tileLoaded&&tileErrors>=4&&providerIndex<tileProviders.length-1){
        providerIndex++;
        loadTileProvider();
      }
    });
    activeTileLayer.addTo(state.networkMap);
  };
  loadTileProvider();
  setTimeout(()=>{
    if(!tileLoaded&&providerIndex<tileProviders.length-1){providerIndex++;loadTileProvider()}
  },2500);

  state.networkMapCluster=L.markerClusterGroup({
    showCoverageOnHover:false,spiderfyOnMaxZoom:true,removeOutsideVisibleBounds:true,maxClusterRadius:58,
    iconCreateFunction:crm3866ClusterIcon
  });
  state.networkMap.addLayer(state.networkMapCluster);
  const bounds=[];let shown=0;
  rows.forEach(x=>{if(crm3866AddMapMarker(x,bounds))shown++});
  const status=document.getElementById('networkMapStatus');
  if(status)status.textContent=`지도에 ${shown}건 표시 · 좌표 확인 중`;
  if(bounds.length)state.networkMap.fitBounds(bounds,{padding:[45,45],maxZoom:16});
  setTimeout(()=>state.networkMap?.invalidateSize(),50);

  const missing=rows.filter(x=>!Number.isFinite(Number(x.latitude))||!Number.isFinite(Number(x.longitude)));
  for(let i=0;i<missing.length;i++){
    if(token!==state.networkMapRenderToken||!state.networkMapMode)return;
    const x=missing[i],address=crm3866FullAddress(x)||x.address;
    if(status)status.textContent=`지도에 ${shown}건 표시 · 주소 좌표 변환 ${i+1}/${missing.length}`;
    const coord=await crm3866GeocodeAddress(address);
    if(coord){x.latitude=coord.lat;x.longitude=coord.lng;crm3866AddMapMarker(x,bounds);shown++;crm3866PersistCoordinates(x.id,coord.lat,coord.lng)}
    if(i<missing.length-1)await new Promise(r=>setTimeout(r,1100));
  }
  if(token!==state.networkMapRenderToken)return;
  if(bounds.length)state.networkMap.fitBounds(bounds,{padding:[45,45],maxZoom:16});
  if(status)status.textContent=`필터 결과 ${rows.length}건 중 지도에 ${shown}건 표시${shown<rows.length?` · 좌표 확인 불가 ${rows.length-shown}건`:''}`;
}
function openNetworkMap(){state.networkMapMode=true;renderNetwork()}
function closeNetworkMap(){state.networkMapMode=false;state.networkMapRenderToken++;if(state.networkMap){state.networkMap.remove();state.networkMap=null}renderNetwork()}

renderNetwork=async function(){
  await loadListings();
  $('#topActions').innerHTML=state.networkMapMode
    ?'<button class="ghost" onclick="closeNetworkMap()">목록으로 보기</button>'
    :'<button class="primary crm3866-map-view-btn" onclick="openNetworkMap()">🗺 지도로 보기</button>';
  $('#content').innerHTML=`<div class="panel crm3826-filter-panel crm3866-network-panel">
    ${crm3826FilterBar('listing')}
    <div id="networkSummary"></div>
    ${state.networkMapMode?`<div class="crm3866-map-head"><div><strong>공동매물 지도</strong><span id="networkMapStatus">좌표를 확인하고 있습니다.</span></div><div class="muted">현재 필터 결과만 지도에 표시됩니다.</div></div><div id="networkMap" class="crm3866-map"></div>`:'<div id="networkTable"></div>'}
  </div>`;
  filterNetwork();
};
filterNetwork=function(){
  const publicRows=state.listings.filter(x=>x.is_public);
  const rows=crm3826FilterRows(publicRows,'listing');
  state.filteredNetworkListings=rows;
  crm3826RenderSummary('networkSummary',rows,'공동매물망 필터 결과');
  if(state.networkMapMode)crm3866RenderMap(rows);else renderListingTable(rows,'networkTable',false);
};
Object.assign(window,{renderNetwork,filterNetwork,openNetworkMap,closeNetworkMap});
console.info('CRM v3.8.67 지도 타일 자동 복구 적용 완료');

/* ===== CRM v3.8.68 카카오맵 전환 ===== */
state.kakaoMapKey = null;
state.kakaoMapSdkPromise = null;
state.kakaoMapOverlays = [];
state.kakaoMapInfoWindow = null;
state.kakaoMapClusterer = null;

async function crm3868LoadMapSetting(){
  try{
    const {data,error}=await state.client.from('app_settings').select('title').eq('setting_key','kakao_map_javascript_key').maybeSingle();
    if(error)throw error;
    state.kakaoMapKey=String(data?.title||'').trim();
  }catch(e){console.warn('카카오맵 설정 조회 실패',e);state.kakaoMapKey=''}
  return state.kakaoMapKey;
}
async function crm3868SaveMapSetting(key){
  if(state.profile?.role!=='admin')return toast('관리자만 지도 설정을 변경할 수 있습니다.');
  const clean=String(key||'').trim();
  if(!clean)return toast('카카오 JavaScript 키를 입력하세요.');
  const payload={setting_key:'kakao_map_javascript_key',title:clean,updated_by:state.profile.id,updated_at:new Date().toISOString()};
  const {error}=await state.client.from('app_settings').upsert(payload,{onConflict:'setting_key'});
  if(error)return toast(error.message);
  state.kakaoMapKey=clean;
  state.kakaoMapSdkPromise=null;
  document.getElementById('kakaoMapsSdk')?.remove();
  modal.close();
  toast('카카오맵 설정을 저장했습니다.');
  if(state.currentView==='network'&&state.networkMapMode)renderNetwork();
}
function crm3868OpenMapSettings(){
  if(state.profile?.role!=='admin')return toast('관리자만 지도 설정을 변경할 수 있습니다.');
  openModal('카카오맵 설정',`<div class="stack crm3868-map-setting">
    <p class="muted">카카오 Developers에서 발급한 <strong>JavaScript 키</strong>를 입력하세요. GitHub Pages 주소를 JavaScript SDK 도메인에 등록해야 합니다.</p>
    <label>카카오 JavaScript 키<input id="crm3868KakaoKey" value="${escapeHtml(state.kakaoMapKey||'')}" placeholder="JavaScript 키" autocomplete="off"></label>
    <div class="notice">등록 도메인 예시: <strong>https://heetae333333-create.github.io</strong></div>
  </div>`,()=>crm3868SaveMapSetting(document.getElementById('crm3868KakaoKey')?.value));
}
async function crm3868EnsureKakaoSdk(){
  if(window.kakao?.maps?.services&&window.kakao?.maps?.MarkerClusterer)return window.kakao;
  if(state.kakaoMapSdkPromise)return state.kakaoMapSdkPromise;
  if(!state.kakaoMapKey)await crm3868LoadMapSetting();
  if(!state.kakaoMapKey)throw new Error('KAKAO_KEY_MISSING');
  state.kakaoMapSdkPromise=new Promise((resolve,reject)=>{
    const existing=document.getElementById('kakaoMapsSdk');
    if(existing)existing.remove();
    const script=document.createElement('script');
    script.id='kakaoMapsSdk';
    script.async=true;
    script.src=`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(state.kakaoMapKey)}&autoload=false&libraries=services,clusterer`;
    script.onload=()=>{
      if(!window.kakao?.maps)return reject(new Error('카카오맵 SDK 초기화 실패'));
      window.kakao.maps.load(()=>resolve(window.kakao));
    };
    script.onerror=()=>reject(new Error('카카오맵 SDK를 불러오지 못했습니다. 도메인과 JavaScript 키를 확인하세요.'));
    document.head.appendChild(script);
  }).catch(e=>{state.kakaoMapSdkPromise=null;throw e});
  return state.kakaoMapSdkPromise;
}
function crm3868NormalizeGeocodeAddress(listing){
  return String(listing.address||'').replace(/\s+/g,' ').trim();
}
async function crm3868GeocodeKakao(address){
  await crm3868EnsureKakaoSdk();
  const geocoder=new kakao.maps.services.Geocoder();
  const query=String(address||'').replace(/\s+(?:[0-9A-Za-z]+동)\s+(?:[0-9A-Za-z]+호)$/,'').trim();
  if(!query)return null;
  return await new Promise(resolve=>{
    geocoder.addressSearch(query,(result,status)=>{
      if(status!==kakao.maps.services.Status.OK||!result?.length)return resolve(null);
      const r=result[0];
      resolve({
        lat:Number(r.y),lng:Number(r.x),
        jibunAddress:r.address?.address_name||query,
        roadAddress:r.road_address?.address_name||'',
        provider:'kakao'
      });
    });
  });
}
async function crm3868PersistKakaoCoordinates(listing,coord){
  if(!listing?.id||!coord)return;
  try{
    const {error}=await state.client.rpc('set_listing_kakao_coordinates',{
      p_listing_id:listing.id,p_lat:coord.lat,p_lng:coord.lng,
      p_jibun_address:coord.jibunAddress||listing.address||'',p_road_address:coord.roadAddress||''
    });
    if(error)throw error;
    listing.latitude=coord.lat;listing.longitude=coord.lng;listing.coordinate_provider='kakao';
    listing.jibun_address=coord.jibunAddress||listing.address||'';listing.road_address=coord.roadAddress||'';
  }catch(e){console.warn('카카오 좌표 저장 실패',e)}
}
function crm3868DealClass(type){return type==='매매'?'sale':type==='전세'?'jeonse':'monthly'}
function crm3868MarkerSvg(listing){
  const deal=crm3866PreferredDeal(listing),type=deal.deal_type||'매물',price=crm3866MapPrice(listing);
  const palette=type==='매매'?['#ef4444','#b91c1c']:type==='전세'?['#2563eb','#1d4ed8']:['#7c3aed','#6d28d9'];
  const safeType=String(type).slice(0,4),safePrice=String(price).slice(0,10);
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="104" height="52" viewBox="0 0 104 52"><defs><filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="2" stdDeviation="2" flood-opacity=".25"/></filter></defs><g filter="url(#s)"><rect x="2" y="2" width="100" height="40" rx="10" fill="white" stroke="${palette[0]}" stroke-width="2"/><path d="M45 42h14l-7 8z" fill="${palette[0]}"/><rect x="2" y="2" width="34" height="40" rx="9" fill="${palette[0]}"/><text x="19" y="27" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" font-weight="700" fill="white">${safeType}</text><text x="69" y="27" text-anchor="middle" font-family="Arial,sans-serif" font-size="13" font-weight="800" fill="#111827">${safePrice}</text></g></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}
function crm3868CreateMarker(listing){
  const position=new kakao.maps.LatLng(Number(listing.latitude),Number(listing.longitude));
  const image=new kakao.maps.MarkerImage(crm3868MarkerSvg(listing),new kakao.maps.Size(104,52),{offset:new kakao.maps.Point(52,52)});
  const marker=new kakao.maps.Marker({position,image,title:listing.title||'매물'});
  marker.__listing=listing;
  kakao.maps.event.addListener(marker,'click',()=>{
    const html=`<div class="crm3868-kakao-popup">${crm3866MapPopup(listing)}</div>`;
    if(state.kakaoMapInfoWindow)state.kakaoMapInfoWindow.close();
    state.kakaoMapInfoWindow=new kakao.maps.InfoWindow({content:html,removable:true});
    state.kakaoMapInfoWindow.open(state.networkMap,marker);
  });
  return marker;
}
function crm3868ClusterStyles(){
  return [{
    width:'48px',height:'48px',background:'rgba(34,197,94,.90)',borderRadius:'24px',color:'#052e16',textAlign:'center',fontWeight:'900',lineHeight:'48px',boxShadow:'0 3px 10px rgba(0,0,0,.18)'
  },{
    width:'58px',height:'58px',background:'rgba(16,185,129,.92)',borderRadius:'29px',color:'#022c22',textAlign:'center',fontWeight:'900',lineHeight:'58px',boxShadow:'0 3px 12px rgba(0,0,0,.2)'
  },{
    width:'68px',height:'68px',background:'rgba(5,150,105,.94)',borderRadius:'34px',color:'white',textAlign:'center',fontWeight:'900',lineHeight:'68px',boxShadow:'0 4px 14px rgba(0,0,0,.24)'
  }];
}
async function crm3868RenderKakaoMap(rows){
  const token=++state.networkMapRenderToken;
  const mapEl=document.getElementById('networkMap');
  const status=document.getElementById('networkMapStatus');
  if(!mapEl)return;
  try{await crm3868EnsureKakaoSdk()}catch(e){
    const missing=e.message==='KAKAO_KEY_MISSING';
    mapEl.innerHTML=`<div class="crm3868-map-error"><strong>${missing?'카카오맵 설정이 필요합니다.':'카카오맵을 불러오지 못했습니다.'}</strong><p>${escapeHtml(missing?'관리자가 카카오 JavaScript 키를 등록해 주세요.':e.message)}</p>${state.profile?.role==='admin'?'<button class="primary" onclick="crm3868OpenMapSettings()">카카오맵 설정</button>':''}</div>`;
    if(status)status.textContent='지도 설정 필요';return;
  }
  if(token!==state.networkMapRenderToken)return;
  mapEl.innerHTML='';
  const center=new kakao.maps.LatLng(37.5665,126.9780);
  state.networkMap=new kakao.maps.Map(mapEl,{center,level:7});
  state.kakaoMapClusterer=new kakao.maps.MarkerClusterer({
    map:state.networkMap,averageCenter:true,minLevel:6,disableClickZoom:false,gridSize:70,styles:crm3868ClusterStyles()
  });
  const bounds=new kakao.maps.LatLngBounds();
  const valid=[];
  const pending=[];
  rows.forEach(x=>{
    const lat=Number(x.latitude),lng=Number(x.longitude);
    if(Number.isFinite(lat)&&Number.isFinite(lng)&&x.coordinate_provider==='kakao')valid.push(x);else pending.push(x);
  });
  const addListing=x=>{
    const marker=crm3868CreateMarker(x);valid.push(x);state.kakaoMapClusterer.addMarker(marker);bounds.extend(marker.getPosition());
  };
  const initial=valid.slice();valid.length=0;initial.forEach(addListing);
  if(initial.length)state.networkMap.setBounds(bounds,80,80,80,80);
  if(status)status.textContent=`카카오 좌표 ${initial.length}건 표시 · ${pending.length}건 확인 중`;
  for(let i=0;i<pending.length;i++){
    if(token!==state.networkMapRenderToken||!state.networkMapMode)return;
    const x=pending[i];
    if(status)status.textContent=`카카오 주소 좌표 확인 ${i+1}/${pending.length}`;
    const coord=await crm3868GeocodeKakao(crm3868NormalizeGeocodeAddress(x));
    if(coord){await crm3868PersistKakaoCoordinates(x,coord);addListing(x)}
    await new Promise(r=>setTimeout(r,120));
  }
  if(valid.length)state.networkMap.setBounds(bounds,80,80,80,80);
  if(status)status.textContent=`필터 결과 ${rows.length}건 중 지도에 ${valid.length}건 표시${valid.length<rows.length?` · 주소 확인 필요 ${rows.length-valid.length}건`:''}`;
  setTimeout(()=>state.networkMap?.relayout?.(),50);
}
async function crm3868RefreshVisibleCoordinates(){
  if(state.profile?.role!=='admin')return toast('관리자만 좌표를 다시 맞출 수 있습니다.');
  const rows=state.filteredNetworkListings||[];
  if(!rows.length)return toast('현재 필터 결과가 없습니다.');
  if(!confirm(`현재 필터 결과 ${rows.length}건의 좌표를 카카오 주소 기준으로 다시 맞출까요?`))return;
  rows.forEach(x=>{x.coordinate_provider='';});
  await crm3868RenderKakaoMap(rows);
  toast('카카오 주소 기준으로 좌표를 다시 확인했습니다.');
}

// 주소 검색 완료 시 카카오 좌표를 즉시 저장할 수 있도록 주소선택 정보를 보관한다.
const crm3868PostcodeBase=crm3861OpenPostcode;
crm3861OpenPostcode=function(addressInput,onDone){
  return crm3868PostcodeBase(addressInput,async(selected,data)=>{
    onDone?.(selected,data);
    try{
      const coord=await crm3868GeocodeKakao(selected);
      const form=addressInput.closest('form')||document.getElementById('modalForm');
      if(coord&&form){
        form.dataset.kakaoLat=String(coord.lat);form.dataset.kakaoLng=String(coord.lng);
        form.dataset.kakaoJibun=coord.jibunAddress||selected;form.dataset.kakaoRoad=coord.roadAddress||'';
      }
    }catch(e){console.warn('주소선택 좌표 준비 실패',e)}
  });
};

// 기존 Leaflet 지도 렌더링을 카카오맵으로 교체한다.
crm3866RenderMap=crm3868RenderKakaoMap;
renderNetwork=async function(){
  await loadListings();
  const adminButtons=state.profile?.role==='admin'?`<button class="ghost" onclick="crm3868OpenMapSettings()">지도 설정</button>${state.networkMapMode?'<button class="ghost" onclick="crm3868RefreshVisibleCoordinates()">좌표 다시 맞추기</button>':''}`:'';
  $('#topActions').innerHTML=state.networkMapMode
    ?`${adminButtons}<button class="ghost" onclick="closeNetworkMap()">목록으로 보기</button>`
    :`${adminButtons}<button class="primary crm3866-map-view-btn" onclick="openNetworkMap()">🗺 지도로 보기</button>`;
  $('#content').innerHTML=`<div class="panel crm3826-filter-panel crm3866-network-panel">
    ${crm3826FilterBar('listing')}
    <div id="networkSummary"></div>
    ${state.networkMapMode?`<div class="crm3866-map-head"><div><strong>공동매물 카카오맵</strong><span id="networkMapStatus">카카오 주소 좌표를 확인하고 있습니다.</span></div><div class="muted">현재 필터 결과만 지도에 표시됩니다.</div></div><div id="networkMap" class="crm3866-map crm3868-kakao-map"></div>`:'<div id="networkTable"></div>'}
  </div>`;
  filterNetwork();
};
Object.assign(window,{renderNetwork,crm3861OpenPostcode,crm3868OpenMapSettings,crm3868SaveMapSetting,crm3868RefreshVisibleCoordinates});
console.info('CRM v3.8.68 카카오맵 전환 적용 완료');

/* ===== CRM v3.8.69 카카오맵 설정 버튼 수정 ===== */
crm3868OpenMapSettings = function(){
  if(state.profile?.role!=='admin'){
    toast('관리자만 지도 설정을 변경할 수 있습니다.');
    return;
  }
  const modalEl=$('#modal');
  const submitBtn=$('#modalSubmit');
  $('#modalTitle').textContent='카카오맵 설정';
  $('#modalBody').innerHTML=`<div class="stack crm3868-map-setting">
    <p class="muted">카카오 Developers에서 발급한 <strong>JavaScript 키</strong>를 입력하세요.</p>
    <label>카카오 JavaScript 키
      <input id="crm3868KakaoKey" value="${escapeHtml(state.kakaoMapKey||'')}" placeholder="JavaScript 키" autocomplete="off" spellcheck="false">
    </label>
    <div class="notice">JavaScript SDK 도메인에는 <strong>https://heetae333333-create.github.io</strong> 를 등록하세요.</div>
  </div>`;
  submitBtn.style.display='';
  submitBtn.classList.remove('hidden');
  submitBtn.textContent='저장';
  submitBtn.onclick=async(e)=>{
    e.preventDefault();
    const key=$('#crm3868KakaoKey')?.value||'';
    await crm3868SaveMapSetting(key);
  };
  const cleanup=()=>{
    submitBtn.textContent='저장';
    submitBtn.style.display='';
    submitBtn.classList.remove('hidden');
    modalEl.removeEventListener('close',cleanup);
  };
  modalEl.addEventListener('close',cleanup);
  modalEl.showModal();
};

crm3868SaveMapSetting = async function(key){
  if(state.profile?.role!=='admin'){
    toast('관리자만 지도 설정을 변경할 수 있습니다.');
    return;
  }
  const clean=String(key||'').trim();
  if(!clean){
    toast('카카오 JavaScript 키를 입력하세요.');
    return;
  }
  const submitBtn=$('#modalSubmit');
  if(submitBtn){submitBtn.disabled=true;submitBtn.textContent='저장 중...';}
  try{
    const payload={
      setting_key:'kakao_map_javascript_key',
      title:clean,
      updated_by:state.profile.id,
      updated_at:new Date().toISOString()
    };
    const {error}=await state.client.from('app_settings').upsert(payload,{onConflict:'setting_key'});
    if(error)throw error;
    state.kakaoMapKey=clean;
    state.kakaoMapSdkPromise=null;
    document.getElementById('kakaoMapsSdk')?.remove();
    $('#modal').close();
    toast('카카오맵 설정을 저장했습니다.');
    if(state.currentView==='network'&&state.networkMapMode)renderNetwork();
  }catch(error){
    console.error('카카오맵 설정 저장 실패',error);
    toast(`카카오맵 설정 저장 실패: ${error?.message||'알 수 없는 오류'}`);
  }finally{
    if(submitBtn){submitBtn.disabled=false;submitBtn.textContent='저장';}
  }
};
Object.assign(window,{crm3868OpenMapSettings,crm3868SaveMapSetting});
console.info('CRM v3.8.69 카카오맵 설정 버튼 수정 완료');

/* ===== CRM v3.8.70 카카오맵 마커 압축·관리자 표시·좌표 자동보정 ===== */
function crm3870Money(value){
  const n=Number(value||0);
  if(!n)return '-';
  if(n>=10000)return `${(n/10000).toFixed(2)}억`;
  return `${Math.round(n).toLocaleString()}만`;
}
function crm3870MarkerPrice(listing){
  const o=crm3866PreferredDeal(listing);
  if(o.deal_type==='월세')return `${crm3870Money(o.price)}/${crm3870Money(o.monthly_rent)}`;
  return crm3870Money(o.price);
}
crm3868MarkerSvg=function(listing){
  const deal=crm3866PreferredDeal(listing),type=deal.deal_type||'매물';
  const typeShort=type==='매매'?'매':type==='전세'?'전':type==='월세'?'월':'매';
  const price=crm3870MarkerPrice(listing);
  const palette=type==='매매'?['#ef4444','#b91c1c']:type==='전세'?['#2563eb','#1d4ed8']:['#7c3aed','#6d28d9'];
  const priceSize=price.length>=10?9:price.length>=8?10:11;
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="88" height="40" viewBox="0 0 88 40"><defs><filter id="s" x="-20%" y="-25%" width="140%" height="155%"><feDropShadow dx="0" dy="1.5" stdDeviation="1.5" flood-opacity=".23"/></filter></defs><g filter="url(#s)"><rect x="1.5" y="1.5" width="85" height="31" rx="8" fill="white" stroke="${palette[0]}" stroke-width="1.8"/><path d="M39 32h10l-5 6z" fill="${palette[0]}"/><rect x="1.5" y="1.5" width="24" height="31" rx="7" fill="${palette[0]}"/><text x="13.5" y="21.5" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" font-weight="800" fill="white">${typeShort}</text><text x="56" y="21.5" text-anchor="middle" font-family="Arial,sans-serif" font-size="${priceSize}" font-weight="800" fill="#111827">${String(price).replace(/&/g,'&amp;').replace(/</g,'&lt;')}</text></g></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
};
crm3868CreateMarker=function(listing){
  const position=new kakao.maps.LatLng(Number(listing.latitude),Number(listing.longitude));
  const image=new kakao.maps.MarkerImage(crm3868MarkerSvg(listing),new kakao.maps.Size(88,40),{offset:new kakao.maps.Point(44,40)});
  const marker=new kakao.maps.Marker({position,image,title:listing.title||'매물'});
  marker.__listing=listing;
  kakao.maps.event.addListener(marker,'click',()=>{
    const html=`<div class="crm3868-kakao-popup">${crm3866MapPopup(listing)}</div>`;
    if(state.kakaoMapInfoWindow)state.kakaoMapInfoWindow.close();
    state.kakaoMapInfoWindow=new kakao.maps.InfoWindow({content:html,removable:true});
    state.kakaoMapInfoWindow.open(state.networkMap,marker);
  });
  return marker;
};

// 지도 전환 시 현재 필터 결과의 좌표를 카카오 주소 기준으로 자동 재확인한다.
openNetworkMap=function(){
  state.networkMapForceCoordinateRefresh=true;
  state.networkMapMode=true;
  renderNetwork();
};
crm3868RenderKakaoMap=async function(rows){
  const token=++state.networkMapRenderToken;
  const mapEl=document.getElementById('networkMap');
  const status=document.getElementById('networkMapStatus');
  if(!mapEl)return;
  try{await crm3868EnsureKakaoSdk()}catch(e){
    const missing=e.message==='KAKAO_KEY_MISSING';
    mapEl.innerHTML=`<div class="crm3868-map-error"><strong>${missing?'카카오맵 설정이 필요합니다.':'카카오맵을 불러오지 못했습니다.'}</strong><p>${escapeHtml(missing?'관리자가 카카오 JavaScript 키를 등록해 주세요.':e.message)}</p>${state.profile?.role==='admin'?'<button class="primary" data-admin-only="true" onclick="crm3868OpenMapSettings()">카카오맵 설정 <span class="crm3870-admin-tag">ADMIN</span></button>':''}</div>`;
    if(status)status.textContent='지도 설정 필요';return;
  }
  if(token!==state.networkMapRenderToken)return;
  mapEl.innerHTML='';
  state.networkMap=new kakao.maps.Map(mapEl,{center:new kakao.maps.LatLng(37.5665,126.9780),level:7});
  state.kakaoMapClusterer=new kakao.maps.MarkerClusterer({map:state.networkMap,averageCenter:true,minLevel:6,disableClickZoom:false,gridSize:70,styles:crm3868ClusterStyles()});
  const bounds=new kakao.maps.LatLngBounds();
  const shown=[];
  const force=!!state.networkMapForceCoordinateRefresh;
  state.networkMapForceCoordinateRefresh=false;
  const addListing=x=>{
    const marker=crm3868CreateMarker(x);
    state.kakaoMapClusterer.addMarker(marker);
    bounds.extend(marker.getPosition());
    shown.push(x);
  };
  const cached=force?[]:rows.filter(x=>Number.isFinite(Number(x.latitude))&&Number.isFinite(Number(x.longitude))&&x.coordinate_provider==='kakao');
  cached.forEach(addListing);
  const pending=force?rows:rows.filter(x=>!cached.includes(x));
  if(cached.length)state.networkMap.setBounds(bounds,80,80,80,80);
  if(status)status.textContent=force?`카카오 좌표 자동 보정 0/${pending.length}`:`카카오 좌표 ${cached.length}건 표시 · ${pending.length}건 확인 중`;
  for(let i=0;i<pending.length;i++){
    if(token!==state.networkMapRenderToken||!state.networkMapMode)return;
    const x=pending[i];
    if(status)status.textContent=force?`카카오 좌표 자동 보정 ${i+1}/${pending.length}`:`카카오 주소 좌표 확인 ${i+1}/${pending.length}`;
    const coord=await crm3868GeocodeKakao(crm3868NormalizeGeocodeAddress(x));
    if(coord){await crm3868PersistKakaoCoordinates(x,coord);addListing(x)}
    await new Promise(r=>setTimeout(r,110));
  }
  if(shown.length)state.networkMap.setBounds(bounds,80,80,80,80);
  if(status)status.textContent=`필터 결과 ${rows.length}건 중 지도에 ${shown.length}건 표시${shown.length<rows.length?` · 주소 확인 필요 ${rows.length-shown.length}건`:''}`;
  setTimeout(()=>state.networkMap?.relayout?.(),50);
};
crm3866RenderMap=crm3868RenderKakaoMap;

function crm3870AdminTag(){return '<span class="crm3870-admin-tag">ADMIN</span>'}
renderNetwork=async function(){
  await loadListings();
  const mapSetting=state.profile?.role==='admin'?`<button class="ghost" data-admin-only="true" onclick="crm3868OpenMapSettings()">지도 설정 ${crm3870AdminTag()}</button>`:'';
  $('#topActions').innerHTML=state.networkMapMode
    ?`${mapSetting}<button class="ghost" onclick="closeNetworkMap()">목록으로 보기</button>`
    :`${mapSetting}<button class="primary crm3866-map-view-btn" onclick="openNetworkMap()">🗺 지도로 보기</button>`;
  $('#content').innerHTML=`<div class="panel crm3826-filter-panel crm3866-network-panel">
    ${crm3826FilterBar('listing')}
    <div id="networkSummary"></div>
    ${state.networkMapMode?`<div class="crm3866-map-head"><div><strong>공동매물 카카오맵</strong><span id="networkMapStatus">카카오 주소 좌표를 자동으로 확인하고 있습니다.</span></div><div class="muted">현재 필터 결과만 지도에 표시됩니다.</div></div><div id="networkMap" class="crm3866-map crm3868-kakao-map"></div>`:'<div id="networkTable"></div>'}
  </div>`;
  filterNetwork();
  setTimeout(crm3870DecorateAdminButtons,0);
};

function crm3870DecorateAdminButtons(){
  if(state.profile?.role!=='admin')return;
  document.querySelectorAll('button').forEach(btn=>{
    if(btn.querySelector('.crm3870-admin-tag'))return;
    const oc=btn.getAttribute('onclick')||'';
    const adminOnly=btn.dataset.adminOnly==='true'||!!btn.closest('.admin-only')||/Admin|admin|MapSettings|MenuOrder|AnnouncementManager|Transfer/.test(oc);
    if(adminOnly)btn.insertAdjacentHTML('beforeend',crm3870AdminTag());
  });
}
if(!window.__crm3870AdminObserver){
  window.__crm3870AdminObserver=new MutationObserver(()=>crm3870DecorateAdminButtons());
  window.__crm3870AdminObserver.observe(document.body,{childList:true,subtree:true});
}
Object.assign(window,{openNetworkMap,renderNetwork,crm3868RenderKakaoMap,crm3870DecorateAdminButtons});
setTimeout(crm3870DecorateAdminButtons,100);
console.info('CRM v3.8.70 카카오맵 마커 압축·관리자 표시·좌표 자동보정 적용 완료');


/* ===== CRM v3.8.71 카카오맵 매물 아이콘 정사각형형·방/전용면적 표시 ===== */
function crm3871TrimNumber(value, maxDigits=2){
  const n=Number(value||0);
  if(!Number.isFinite(n))return '-';
  return n.toFixed(maxDigits).replace(/\.0+$|(?<=\.[0-9]*?)0+$/,'').replace(/\.$/,'');
}
function crm3871Money(value){
  const n=Number(value||0);
  if(!n)return '-';
  if(n>=10000)return `${crm3871TrimNumber(n/10000,2)}억`;
  return `${Math.round(n).toLocaleString()}만`;
}
function crm3871MarkerPrice(listing){
  const o=crm3866PreferredDeal(listing);
  if(o.deal_type==='월세'){
    const deposit=Number(o.price||0);
    const rent=Number(o.monthly_rent||0);
    const d=deposit>=10000?crm3871Money(deposit):Math.round(deposit).toLocaleString();
    return `${d}/${Math.round(rent).toLocaleString()}`;
  }
  return crm3871Money(o.price);
}
function crm3871RoomLabel(listing){
  if(listing?.is_one_point_five_room)return '방1.5';
  const n=Number(listing?.room_count);
  return Number.isFinite(n)&&n>=0?`방${crm3871TrimNumber(n,1)}`:'방-';
}
function crm3871AreaLabel(listing){
  const n=Number(listing?.area_m2);
  return Number.isFinite(n)&&n>0?`${crm3871TrimNumber(n,2)}㎡`:'-㎡';
}
crm3868MarkerSvg=function(listing){
  const deal=crm3866PreferredDeal(listing),type=deal.deal_type||'매물';
  const typeShort=type==='매매'?'매':type==='전세'?'전':type==='월세'?'월':'매';
  const price=crm3871MarkerPrice(listing);
  const room=crm3871RoomLabel(listing);
  const area=crm3871AreaLabel(listing);
  const palette=type==='매매'?['#ef4444','#b91c1c']:type==='전세'?['#2563eb','#1d4ed8']:['#7c3aed','#6d28d9'];
  const priceSize=price.length>=9?9:price.length>=7?10:11;
  const esc=v=>String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="78" height="58" viewBox="0 0 78 58">
    <defs><filter id="s" x="-25%" y="-25%" width="150%" height="165%"><feDropShadow dx="0" dy="1.4" stdDeviation="1.5" flood-opacity=".23"/></filter></defs>
    <g filter="url(#s)">
      <rect x="1.5" y="1.5" width="75" height="49" rx="8" fill="white" stroke="${palette[0]}" stroke-width="1.7"/>
      <path d="M34 50h10l-5 6z" fill="${palette[0]}"/>
      <rect x="1.5" y="1.5" width="21" height="27" rx="7" fill="${palette[0]}"/>
      <text x="12" y="19.5" text-anchor="middle" font-family="Arial,sans-serif" font-size="11.5" font-weight="800" fill="white">${typeShort}</text>
      <text x="49" y="19.5" text-anchor="middle" font-family="Arial,sans-serif" font-size="${priceSize}" font-weight="800" fill="#111827">${esc(price)}</text>
      <line x1="8" y1="30" x2="70" y2="30" stroke="#e5e7eb" stroke-width="1"/>
      <text x="39" y="43" text-anchor="middle" font-family="Arial,sans-serif" font-size="8.8" font-weight="700" fill="#4b5563">${esc(room)} · ${esc(area)}</text>
    </g>
  </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
};
crm3868CreateMarker=function(listing){
  const position=new kakao.maps.LatLng(Number(listing.latitude),Number(listing.longitude));
  const image=new kakao.maps.MarkerImage(crm3868MarkerSvg(listing),new kakao.maps.Size(78,58),{offset:new kakao.maps.Point(39,58)});
  const marker=new kakao.maps.Marker({position,image,title:listing.title||'매물'});
  marker.__listing=listing;
  kakao.maps.event.addListener(marker,'click',()=>{
    const html=`<div class="crm3868-kakao-popup">${crm3866MapPopup(listing)}</div>`;
    if(state.kakaoMapInfoWindow)state.kakaoMapInfoWindow.close();
    state.kakaoMapInfoWindow=new kakao.maps.InfoWindow({content:html,removable:true});
    state.kakaoMapInfoWindow.open(state.networkMap,marker);
  });
  return marker;
};
console.info('CRM v3.8.71 카카오맵 매물 아이콘 개선 완료');
