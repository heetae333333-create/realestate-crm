const state = { client:null, session:null, profile:null, view:'dashboard', customers:[], listings:[], members:[], adminSelectedListings:new Set() };
const $ = (s)=>document.querySelector(s);
const $$ = (s)=>[...document.querySelectorAll(s)];
const SUPA_URL_KEY='crm_supabase_url', SUPA_ANON_KEY='crm_supabase_anon';
const DEFAULT_SUPABASE_URL='https://zcxxxqyntzlvyaakbnlq.supabase.co';
const DEFAULT_SUPABASE_PUBLISHABLE_KEY='sb_publishable_k1lbkjVDKgYgxq_kp9lzsw_iNGSVbnJ';

function toast(msg){const el=$('#toast');el.textContent=msg;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2600)}
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
  $('#customerTable').innerHTML=rows.length?`<div class="table-wrap"><table class="customer-table"><thead><tr><th>고객명</th><th>연락처</th><th>구분</th><th>상태</th><th>거래유형</th><th>등급</th><th>희망지역</th><th>방개수</th><th>희망금액/월세</th><th>계약단계</th><th>최종 FU</th><th>예정 FU</th><th>관리</th></tr></thead><tbody>${rows.map(x=>`<tr><td><strong>${escapeHtml(x.name)}</strong></td><td>${escapeHtml(x.phone||'-')}</td><td>${escapeHtml(x.customer_type)}</td><td>${badge(x.status||'신규','blue')}</td><td>${escapeHtml(x.deal_type||'-')}</td><td>${gradeBadge(x.customer_grade)}</td><td>${escapeHtml(x.preferred_area||'-')}</td><td>${customerRoomText(x)}</td><td>${customerBudgetText(x)}</td><td>${contractStage(x)}</td><td>${fmtDate(x.last_follow_up_at)}</td><td>${dueBadge(x.next_follow_up_at)}</td><td><div class="row-actions"><button class="success" onclick="openFollowUpModal('customer','${x.id}')">FU</button><button class="ghost" onclick="openHistoryModal('customer','${x.id}')">히스토리</button><button class="ghost" onclick="openContractModal('customer','${x.id}')">계약일정</button><button class="ghost" onclick="openCustomerModal('${x.id}')">수정</button><button class="danger" onclick="deleteCustomer('${x.id}')">삭제</button></div></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">조건에 맞는 고객이 없습니다.</div>';
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
  const el=$('#'+target);el.innerHTML=rows.length?`<div class="table-wrap listing-table-wrap"><table class="listing-table"><thead><tr>${adminMode?'<th class="select-col">선택</th>':''}<th>상태</th><th>거래</th><th>유형</th><th>매물명</th><th>지역</th><th>금액/월세</th><th>연락처</th><th>대출</th><th>전용면적</th><th>방/욕실</th><th>입주</th><th>담당</th><th>계약</th><th>최종 FU</th><th>예정 FU</th>${mine?'<th>관리</th>':''}</tr></thead><tbody>${rows.map(x=>`<tr>${adminMode?`<td class="select-col"><input type="checkbox" class="admin-listing-check" value="${x.id}" ${state.adminSelectedListings.has(x.id)?'checked':''} onchange="toggleAdminListingSelection('${x.id}',this.checked)"></td>`:''}<td class="crm3812-status-cell"><div class="crm3812-list-address" title="${escapeHtml(x.address||x.district||'주소 미입력')}">${escapeHtml(x.address||x.district||'주소 미입력')}</div>${badge(x.status==='available'?'거래 가능':x.status==='complete'?'거래 완료':'협의 중',x.status==='available'?'green':x.status==='complete'?'gray':'yellow')}</td><td>${escapeHtml(x.transaction_type)}</td><td>${escapeHtml(x.property_type)}</td><td class="listing-title-cell"><strong>${escapeHtml(x.title)}</strong>${x.is_public?'':' '+badge('비공개','red')}<br><button type="button" class="photo-link" onclick="openListingPhotos('${x.id}')">📷 내부사진</button></td><td>${escapeHtml(listingAreaText(x))}</td><td>${listingPriceText(x)}</td><td>${escapeHtml(x.contact_phone||'-')}</td><td>${x.loan_available===true?badge('O','green'):x.loan_available===false?badge('X','red'):badge('미확인','gray')}${x.loan_available===true&&x.official_price?`<br><span class="muted">기준 ${fmtMoney(x.official_price)}</span>`:''}</td><td>${x.area_m2?`${x.area_m2}㎡<br><span class="muted">약 ${(Number(x.area_m2)/3.3058).toFixed(2)}평</span>`:'-'}</td><td>${listingRoomText(x)} / ${x.bathroom_count!==null&&x.bathroom_count!==undefined?escapeHtml(String(x.bathroom_count)):'-'}</td><td>${moveInText(x)}</td><td>${escapeHtml(x.owner?.full_name||'-')}</td><td>${contractStage(x)}</td><td>${fmtDate(x.last_follow_up_at||x.last_confirmed_at)}</td><td>${dueBadge(x.next_follow_up_at)}</td>${mine?`<td><div class="row-actions"><button class="success" onclick="openFollowUpModal('listing','${x.id}')">FU</button><button class="ghost" onclick="openHistoryModal('listing','${x.id}')">히스토리</button><button class="ghost" onclick="openContractModal('listing','${x.id}')">계약일정</button><button class="ghost" onclick="openListingModal('${x.id}')">수정</button>${adminMode?`<button class="primary" onclick="openSingleListingTransfer('${x.id}')">개별 이관</button>`:''}<button class="danger" onclick="deleteListing('${x.id}')">삭제</button></div></td>`:''}</tr>`).join('')}</tbody></table></div>`:'<div class="empty">조건에 맞는 매물이 없습니다.</div>';
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
function crm37AnnouncementCards(){
  return state.announcements.length?`<div class="announcement-list">${state.announcements.map(a=>`<article class="announcement-card ${a.is_pinned?'pinned':''}"><div class="announcement-title">${a.is_pinned?'📌 ':''}${escapeHtml(a.title)}</div><div class="announcement-body">${escapeHtml(a.content||'').replace(/\n/g,'<br>')}</div><div class="muted">${escapeHtml(a.author?.full_name||'관리자')} · ${fmtDate(a.created_at)}</div></article>`).join('')}</div>`:'<div class="empty">등록된 공지사항이 없습니다.</div>';
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
  <div class="split" style="margin-top:16px"><section class="panel"><div class="panel-head"><h3>신규 매물 알림·재매칭</h3><button class="ghost" onclick="renderView('smartMatch')">자동매칭</button></div>${matchingPairs.slice(0,12).map(p=>`<div class="list-item"><div><strong>${escapeHtml(p.l.title)}</strong><div class="muted">${escapeHtml(p.c.name)} 고객 · ${escapeHtml(p.m.category)}</div></div><button class="success" onclick="crm36SaveRecommendation('${p.c.id}','${p.l.id}')">FU 저장</button></div>`).join('')||'<div class="empty">최근 7일 신규 매칭 후보가 없습니다.</div>'}</section><section class="panel"><div class="panel-head"><h3>공지사항</h3>${state.profile?.role==='admin'?'<button class="primary" onclick="crm37ManageAnnouncements()">공지 관리</button>':''}</div>${crm37AnnouncementCards()}</section></div>`;
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
  $('#customerTable').innerHTML=rows.length?`<div class="table-wrap"><table class="customer-table"><thead><tr><th>고객명</th><th>연락처</th><th>단계</th><th>미접촉</th><th>거래유형</th><th>등급</th><th>희망지역</th><th>방</th><th>희망금액/월세</th><th>예정 FU</th><th>관리</th></tr></thead><tbody>${rows.map(x=>{const dorm=crm37DormantInfo(x);return `<tr><td><strong>${escapeHtml(x.name)}</strong></td><td>${escapeHtml(x.phone||'-')}</td><td>${badge(x.status||'신규 문의','blue')}</td><td>${dorm.label?badge(dorm.label,dorm.color):badge('최근 연락','green')}</td><td>${escapeHtml(x.deal_type||'-')}</td><td>${gradeBadge(x.customer_grade)}</td><td>${escapeHtml(x.preferred_area||'-')}</td><td>${customerRoomText(x)}</td><td>${customerBudgetText(x)}</td><td>${dueBadge(x.next_follow_up_at)}</td><td><div class="row-actions"><button class="success" onclick="openFollowUpModal('customer','${x.id}')">FU</button><button class="ghost" onclick="openHistoryModal('customer','${x.id}')">히스토리</button><button class="ghost" onclick="openContractModal('customer','${x.id}')">계약일정</button><button class="ghost" onclick="openCustomerModal('${x.id}')">수정</button><button class="danger" onclick="deleteCustomer('${x.id}')">삭제</button></div></td></tr>`}).join('')}</tbody></table></div>`:'<div class="empty">조건에 맞는 고객이 없습니다.</div>';
};

async function crm37ManageAnnouncements(){
  if(state.profile?.role!=='admin')return;
  await crm37LoadAnnouncements();$('#modalTitle').textContent='공지사항 관리';$('#modalBody').innerHTML=`<div class="form-grid"><label class="span-2">제목<input id="annTitle" maxlength="100"></label><label class="span-2">내용<textarea id="annContent" rows="6"></textarea></label><label class="inline-check"><input id="annPinned" type="checkbox"> 상단 고정</label></div><div class="panel" style="margin-top:16px"><h4>현재 공지</h4>${state.announcements.map(a=>`<div class="list-item"><div><strong>${escapeHtml(a.title)}</strong><div class="muted">${escapeHtml((a.content||'').slice(0,80))}</div></div><button class="danger" onclick="crm37DeleteAnnouncement('${a.id}')">삭제</button></div>`).join('')||'<div class="empty">공지 없음</div>'}</div>`;$('#modalSubmit').style.display='';$('#modalSubmit').onclick=async e=>{e.preventDefault();const title=$('#annTitle').value.trim(),content=$('#annContent').value.trim();if(!title||!content)return toast('제목과 내용을 입력하세요.');const {error}=await state.client.from('announcements').insert({title,content,is_pinned:$('#annPinned').checked,created_by:state.profile.id,is_active:true});if(error)return toast(error.message);$('#modal').close();toast('공지사항을 등록했습니다.');renderDashboard()};$('#modal').showModal();
}
async function crm37DeleteAnnouncement(id){if(!confirm('공지사항을 삭제할까요?'))return;const {error}=await state.client.from('announcements').update({is_active:false}).eq('id',id);if(error)return toast(error.message);$('#modal').close();toast('공지사항을 삭제했습니다.');renderDashboard()}

const crm37BaseRenderAdminStats=renderAdminStats;
renderAdminStats=async function(){await crm37BaseRenderAdminStats();await Promise.all([loadCustomers(),loadListings(),loadMembers()]);const now=today();const rows=state.members.filter(m=>m.status==='approved').map(m=>{const cs=state.customers.filter(c=>c.owner_id===m.id),ls=state.listings.filter(l=>l.owner_id===m.id);return {m,customers:cs.length,listings:ls.length,due:cs.filter(c=>c.next_follow_up_at&&c.next_follow_up_at<=now).length,dormant:cs.filter(c=>crm37DormantInfo(c).days>=14).length,contracts:[...cs,...ls].filter(x=>x.contract_date||x.final_payment_date).length}});$('#content').insertAdjacentHTML('afterbegin',`<div class="panel" style="margin-bottom:16px"><div class="panel-head"><div><h3>담당 중개사 업무량</h3><div class="muted">업무 누락과 담당 편중을 확인하는 관리용 화면입니다.</div></div></div><div class="table-wrap"><table><thead><tr><th>중개사</th><th>고객</th><th>매물</th><th>오늘·지연 FU</th><th>14일+ 미접촉</th><th>계약 진행/완료</th></tr></thead><tbody>${rows.map(r=>`<tr><td><strong>${escapeHtml(r.m.full_name||'-')}</strong></td><td>${r.customers}</td><td>${r.listings}</td><td>${r.due?badge(String(r.due),'red'):'0'}</td><td>${r.dormant?badge(String(r.dormant),'yellow'):'0'}</td><td>${r.contracts}</td></tr>`).join('')}</tbody></table></div></div>`);crm37AddQuickActions();};

Object.assign(window,{renderView,renderDashboard,renderCustomers,filterCustomers,openCustomerModal,crm37OpenQuickCustomer,crm37OpenQuickListing,crm37ManageAnnouncements,crm37DeleteAnnouncement});
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
renderListingTable=function(rows,target,mine,adminMode=false){const el=$('#'+target);el.innerHTML=rows.length?`<div class="table-wrap listing-table-wrap"><table class="listing-table"><thead><tr>${adminMode?'<th class="select-col">선택</th>':''}<th>상태</th><th>거래</th><th>유형</th><th>매물명</th><th>지역</th><th>금액</th><th>연락처</th><th>대출</th><th>전용면적</th><th>방/욕실</th><th>입주</th><th>담당</th><th>계약</th><th>최종 FU</th><th>예정 FU</th>${mine?'<th>관리</th>':''}</tr></thead><tbody>${rows.map(x=>`<tr>${adminMode?`<td><input type="checkbox" class="admin-listing-check" value="${x.id}" onchange="toggleAdminListingSelection('${x.id}',this.checked)"></td>`:''}<td class="crm3812-status-cell"><div class="crm3812-list-address" title="${escapeHtml(x.address||x.district||'주소 미입력')}">${escapeHtml(x.address||x.district||'주소 미입력')}</div>${badge(x.status==='available'?'거래 가능':x.status==='complete'?'거래 완료':'협의 중',x.status==='available'?'green':x.status==='complete'?'gray':'yellow')}</td><td>${escapeHtml(crm38DealTypeText(x))}</td><td>${escapeHtml(x.property_type)}</td><td><button type="button" class="crm3814-listing-title-link" onclick="openListingDetail('${x.id}')" title="매물 상세정보 보기">${escapeHtml(x.title)}</button>${x.is_public?'':' '+badge('비공개','red')}<br><button class="photo-link" onclick="openListingPhotos('${x.id}')">📷 내부사진</button></td><td>${escapeHtml(listingAreaText(x))}</td><td>${listingPriceText(x)}</td><td>${crm382ContactDisplay(x)}</td><td>${x.loan_available===true?badge('O','green'):x.loan_available===false?badge('X','red'):badge('미확인','gray')}</td><td>${x.area_m2?`${x.area_m2}㎡<br><span class="muted">약 ${(Number(x.area_m2)/3.3058).toFixed(2)}평</span>`:'-'}</td><td>${listingRoomText(x)} / ${x.bathroom_count??'-'}</td><td>${moveInText(x)}</td><td>${escapeHtml(x.owner?.full_name||'-')}</td><td>${contractStage(x)}</td><td>${fmtDate(x.last_follow_up_at||x.last_confirmed_at)}</td><td>${dueBadge(x.next_follow_up_at)}</td>${mine?`<td><div class="row-actions"><button class="success" onclick="openFollowUpModal('listing','${x.id}')">FU</button><button class="ghost" onclick="openHistoryModal('listing','${x.id}')">히스토리</button><button class="ghost" onclick="openContractModal('listing','${x.id}')">계약일정</button><button class="ghost" onclick="openListingModal('${x.id}')">수정</button>${adminMode?`<button class="primary" onclick="openSingleListingTransfer('${x.id}')">개별 이관</button>`:''}<button class="danger" onclick="deleteListing('${x.id}')">삭제</button></div></td>`:''}</tr>`).join('')}</tbody></table></div>`:'<div class="empty">조건에 맞는 매물이 없습니다.</div>';if(adminMode)updateBulkTransferControls()};
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
  el.innerHTML=rows.length?`<div class="table-wrap listing-table-wrap"><table class="listing-table crm3813-listing-table"><thead><tr>${adminMode?'<th class="select-col">선택</th>':''}<th>상태</th><th>거래</th><th>유형</th><th>매물명</th><th>지역</th><th>금액</th><th>연락처</th><th>대출</th><th>전용면적</th><th>방/욕실</th><th>입주</th><th>담당</th><th>계약</th><th>최종 FU</th><th>예정 FU</th>${mine?'<th>관리</th>':''}</tr></thead><tbody>${rows.map(x=>`<tr class="crm3813-address-row">${adminMode?'<td></td>':''}<td colspan="3"><div title="${escapeHtml(x.address||x.district||'주소 미입력')}">${escapeHtml(x.address||x.district||'주소 미입력')}</div></td><td colspan="${totalCols-(adminMode?1:0)-3}"></td></tr><tr>${adminMode?`<td><input type="checkbox" class="admin-listing-check" value="${x.id}" onchange="toggleAdminListingSelection('${x.id}',this.checked)"></td>`:''}<td>${badge(x.status==='available'?'거래 가능':x.status==='complete'?'거래 완료':'협의 중',x.status==='available'?'green':x.status==='complete'?'gray':'yellow')}</td><td>${escapeHtml(crm38DealTypeText(x))}</td><td>${escapeHtml(x.property_type)}</td><td><button type="button" class="crm3814-listing-title-link" onclick="openListingDetail('${x.id}')" title="매물 상세정보 보기">${escapeHtml(x.title)}</button>${x.is_public?'':' '+badge('비공개','red')}<br><button class="photo-link" onclick="openListingPhotos('${x.id}')">📷 내부사진</button></td><td>${escapeHtml(listingAreaText(x))}</td><td>${listingPriceText(x)}</td><td>${crm382ContactDisplay(x)}</td><td>${x.loan_available===true?badge('O','green'):x.loan_available===false?badge('X','red'):badge('미확인','gray')}</td><td>${x.area_m2?`${x.area_m2}㎡<br><span class="muted">약 ${(Number(x.area_m2)/3.3058).toFixed(2)}평</span>`:'-'}</td><td>${listingRoomText(x)} / ${x.bathroom_count??'-'}</td><td>${moveInText(x)}</td><td>${escapeHtml(x.owner?.full_name||'-')}</td><td>${contractStage(x)}</td><td>${fmtDate(x.last_follow_up_at||x.last_confirmed_at)}</td><td>${dueBadge(x.next_follow_up_at)}</td>${mine?`<td><div class="row-actions"><button class="success" onclick="openFollowUpModal('listing','${x.id}')">FU</button><button class="ghost" onclick="openHistoryModal('listing','${x.id}')">히스토리</button><button class="ghost" onclick="openContractModal('listing','${x.id}')">계약일정</button><button class="ghost" onclick="openListingModal('${x.id}')">수정</button>${adminMode?`<button class="primary" onclick="openSingleListingTransfer('${x.id}')">개별 이관</button>`:''}<button class="danger" onclick="deleteListing('${x.id}')">삭제</button></div></td>`:''}</tr>`).join('')}</tbody></table></div>`:'<div class="empty">조건에 맞는 매물이 없습니다.</div>';
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
  $('#documentList').innerHTML=rows.length?`<div class="table-wrap"><table class="crm3813-contract-table"><thead><tr><th>주소</th><th>매물명</th><th>거래조건</th><th>계약</th><th>계약일</th><th>잔금일</th><th>관리</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${escapeHtml(x.contract_address||'-')}</td><td><strong>${escapeHtml(x.listing_title||x.file_name||'-')}</strong></td><td>${escapeHtml(x.deal_terms||'-')}</td><td>${badge('계약서 있음','green')}<br><span class="muted">${escapeHtml(x.brokerage_type||'-')}</span></td><td>${fmtDate(x.contract_date)}</td><td>${fmtDate(x.balance_date)}</td><td><div class="row-actions"><button onclick="downloadContractDocument('${x.storage_path}','${escapeHtml(x.file_name)}')">다운로드</button><button class="danger" onclick="deleteContractDocument('${x.id}','${x.storage_path}')">삭제</button></div></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">등록된 계약서가 없습니다.</div>';
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
