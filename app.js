const state = { client:null, session:null, profile:null, view:'dashboard', customers:[], listings:[], members:[] };
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
function contractDetailText(item,entityType){const parts=[];if(item.contracted_property_name)parts.push(`매물명: ${item.contracted_property_name}`);if(item.contracted_transaction_type)parts.push(`거래유형: ${item.contracted_transaction_type}`);if(item.contracted_amount!==null&&item.contracted_amount!==undefined&&item.contracted_amount!=='')parts.push(`거래금액: ${fmtMoney(item.contracted_amount)}`);if(item.counterparty_name)parts.push(`거래 고객명: ${item.counterparty_name}`);if(item.counterparty_phone){let label='상대방 연락처';if(entityType==='customer'){label=['매수','임차'].includes(item.customer_type)?'매도/임대측 연락처':'매수/임차측 연락처'}else label='매수/임차측 연락처';parts.push(`${label}: ${item.counterparty_phone}`)}return parts.join(' / ')}
function badge(text,type='gray'){return `<span class="badge ${type}">${text}</span>`}
function gradeBadge(grade){const g=grade||'C';const colors={A:'grade-a',B:'grade-b',C:'grade-c',D:'grade-d'};return `<span class="customer-grade ${colors[g]||'grade-c'}">${escapeHtml(g)}</span>`}
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
function listingMini(rows){return rows.length?`<div class="list">${rows.map(x=>`<div class="list-item"><div><strong>${escapeHtml(x.title)}</strong><div class="muted">${escapeHtml(x.district||'')} · ${escapeHtml(x.transaction_type)} · ${fmtMoney(x.price)}</div></div>${badge(x.status==='available'?'거래 가능':'관리 중',x.status==='available'?'green':'gray')}</div>`).join('')}</div>`:'<div class="empty">등록된 매물이 없습니다.</div>'}
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
  $('#customerTable').innerHTML=rows.length?`<div class="table-wrap"><table class="customer-table"><thead><tr><th>고객명</th><th>연락처</th><th>구분</th><th>상태</th><th>거래유형</th><th>등급</th><th>희망지역</th><th>방개수</th><th>희망금액</th><th>계약단계</th><th>최종 FU</th><th>예정 FU</th><th>관리</th></tr></thead><tbody>${rows.map(x=>`<tr><td><strong>${escapeHtml(x.name)}</strong></td><td>${escapeHtml(x.phone||'-')}</td><td>${escapeHtml(x.customer_type)}</td><td>${badge(x.status||'신규','blue')}</td><td>${escapeHtml(x.deal_type||'-')}</td><td>${gradeBadge(x.customer_grade)}</td><td>${escapeHtml(x.preferred_area||'-')}</td><td>${x.desired_rooms!==null&&x.desired_rooms!==undefined&&x.desired_rooms!==''?`${escapeHtml(String(x.desired_rooms))}개`:'-'}</td><td>${fmtMoney(x.budget_max)}</td><td>${contractStage(x)}</td><td>${fmtDate(x.last_follow_up_at)}</td><td>${dueBadge(x.next_follow_up_at)}</td><td><div class="row-actions"><button class="success" onclick="openFollowUpModal('customer','${x.id}')">FU</button><button class="ghost" onclick="openHistoryModal('customer','${x.id}')">히스토리</button><button class="ghost" onclick="openContractModal('customer','${x.id}')">계약일정</button><button class="ghost" onclick="openCustomerModal('${x.id}')">수정</button><button class="danger" onclick="deleteCustomer('${x.id}')">삭제</button></div></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">조건에 맞는 고객이 없습니다.</div>';
}
function openCustomerModal(id){
  const x=state.customers.find(v=>v.id===id)||{};$('#modalTitle').textContent=id?'고객 수정':'고객 등록';
  $('#modalBody').innerHTML=`<div class="form-grid"><label>고객명<input name="name" value="${escapeHtml(x.name||'')}" required></label><label>연락처<input name="phone" value="${escapeHtml(x.phone||'')}" placeholder="010-0000-0000" required></label><label>고객 구분<select id="customerKind" name="customer_type"><option>매수</option><option>매도</option><option>임차</option><option>임대</option></select></label><label>상태<select name="status"><option>신규</option><option>상담중</option><option>매물제안</option><option>방문예정</option><option>계약협의</option><option>계약완료</option><option>보류</option></select></label><label id="customerDealTypeWrap">거래유형<select name="deal_type"><option value="">선택</option><option>매매</option><option>전세</option><option>월세</option><option>매매+전세</option><option>매매+월세</option><option>전세+월세</option></select></label><label>고객등급<select name="customer_grade"><option>A</option><option>B</option><option>C</option><option>D</option></select></label><label>희망 지역<input name="preferred_area" value="${escapeHtml(x.preferred_area||'')}"></label><label id="customerRoomsWrap">희망 방개수<input name="desired_rooms" type="number" min="0" step="1" value="${x.desired_rooms??''}" placeholder="예: 3"></label><label>희망 최대금액(만원)<input name="budget_max" type="number" value="${x.budget_max||''}"></label><label id="customerLoanWrap">대출 여부<select name="loan_available"><option value="true">O</option><option value="false">X</option></select></label><label id="customerEquityWrap">자기자본금(만원)<div class="inline-field"><input id="equityCapitalInput" name="equity_capital" type="number" min="0" value="${x.equity_capital??''}" placeholder="예: 20000"><label class="inline-check"><input id="equityUnknownCheck" name="equity_unknown" type="checkbox" ${x.equity_unknown?'checked':''}> 모름</label></div></label><label>예정 FU<input name="next_follow_up_at" type="date" value="${x.next_follow_up_at?x.next_follow_up_at.slice(0,10):''}"></label><label class="span-2">상담 메모<textarea name="notes" rows="5">${escapeHtml(x.notes||'')}</textarea></label></div>`;
  const kind=$('#customerKind');kind.value=x.customer_type||'매수';
  const dealWrap=$('#customerDealTypeWrap'),roomsWrap=$('#customerRoomsWrap'),loanWrap=$('#customerLoanWrap'),equityWrap=$('#customerEquityWrap'),equityInput=$('#equityCapitalInput'),equityUnknown=$('#equityUnknownCheck');
  const syncEquityUnknown=()=>{equityInput.disabled=equityUnknown.checked;if(equityUnknown.checked)equityInput.value='';};equityUnknown.onchange=syncEquityUnknown;syncEquityUnknown();const toggleBuyerFields=()=>{const show=['매수','임차'].includes(kind.value);[dealWrap,roomsWrap,loanWrap,equityWrap].forEach(el=>el.style.display=show?'':'none');if(!show){dealWrap.querySelector('select').value='';roomsWrap.querySelector('input').value='';loanWrap.querySelector('select').value='false';equityInput.value='';equityUnknown.checked=false;syncEquityUnknown()}};
  kind.onchange=toggleBuyerFields;toggleBuyerFields();
  $('#modalBody').querySelector('[name=status]').value=x.status||'신규';$('#modalBody').querySelector('[name=deal_type]').value=x.deal_type||'';$('#modalBody').querySelector('[name=customer_grade]').value=x.customer_grade||'C';$('#modalBody').querySelector('[name=loan_available]').value=x.loan_available===true?'true':'false';
  $('#modalSubmit').onclick=async(e)=>{e.preventDefault();const fd=new FormData($('#modalForm'));const payload=Object.fromEntries(fd.entries());payload.owner_id=state.profile.id;const buyerSide=['매수','임차'].includes(payload.customer_type);payload.deal_type=buyerSide?(payload.deal_type||null):null;payload.customer_grade=payload.customer_grade||'C';payload.budget_max=payload.budget_max?Number(payload.budget_max):null;payload.desired_rooms=buyerSide&&payload.desired_rooms!==''?Number(payload.desired_rooms):null;payload.loan_available=buyerSide?payload.loan_available==='true':null;payload.equity_unknown=buyerSide&&payload.equity_unknown==='on';payload.equity_capital=buyerSide&&!payload.equity_unknown&&payload.equity_capital?Number(payload.equity_capital):null;payload.official_price=null;payload.next_follow_up_at=payload.next_follow_up_at||null;delete payload.next_contact_at;const q=id?state.client.from('customers').update(payload).eq('id',id):state.client.from('customers').insert(payload);const {error}=await q;if(error)return toast(error.message);$('#modal').close();toast('저장했습니다.');renderCustomers()};$('#modal').showModal();
}
async function deleteCustomer(id){if(!confirm('이 고객을 삭제할까요?'))return;const {error}=await state.client.from('customers').delete().eq('id',id);if(error)return toast(error.message);toast('삭제했습니다.');renderCustomers()}

async function renderMyListings(){await loadListings();state.myListings=state.listings.filter(x=>x.owner_id===state.profile.id);$('#topActions').innerHTML='<button class="primary" onclick="openListingModal()">+ 매물 등록</button>';$('#content').innerHTML=`<div class="notice" style="margin-bottom:14px">이 시트에서 등록한 매물은 공개 상태가 ‘공개’인 경우 공동매물망에 자동으로 올라갑니다.</div><div class="panel"><div id="myListingTable"></div></div>`;renderListingTable(state.myListings,'myListingTable',true)}

async function renderAdminListings(){
  if(state.profile.role!=='admin')return renderView('dashboard');
  await Promise.all([loadListings(),loadMembers()]);
  $('#topActions').innerHTML='<button class="primary" onclick="openListingModal()">+ 관리자 매물 등록</button>';
  $('#content').innerHTML=`<div class="notice" style="margin-bottom:14px">관리자는 모든 중개사의 공개·비공개 매물을 열람, 수정, 삭제하고 매물별로 담당자를 이관할 수 있습니다.</div><div class="panel"><div class="filters admin-listing-filters"><input id="adminListingSearch" placeholder="매물명·주소·담당자 검색" oninput="filterAdminListings()"><select id="adminListingOwner" onchange="filterAdminListings()"><option value="">전체 담당자</option>${state.members.filter(x=>x.status==='approved').map(x=>`<option value="${x.id}">${escapeHtml(x.full_name)} · ${escapeHtml(x.office_name||'')}</option>`).join('')}</select><select id="adminListingVisibility" onchange="filterAdminListings()"><option value="">공개+비공개</option><option value="public">공개</option><option value="private">비공개</option></select><select id="adminListingStatus" onchange="filterAdminListings()"><option value="">전체 상태</option><option value="available">거래 가능</option><option value="hold">협의 중</option><option value="complete">거래 완료</option></select></div><div id="adminListingTable"></div></div>`;
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
  const el=$('#'+target);el.innerHTML=rows.length?`<div class="table-wrap listing-table-wrap"><table class="listing-table"><thead><tr><th>상태</th><th>거래</th><th>유형</th><th>매물명</th><th>지역</th><th>금액</th><th>연락처</th><th>대출</th><th>면적</th><th>입주</th><th>담당</th><th>계약</th><th>최종 FU</th><th>예정 FU</th>${mine?'<th>관리</th>':''}</tr></thead><tbody>${rows.map(x=>`<tr><td>${badge(x.status==='available'?'거래 가능':x.status==='complete'?'거래 완료':'협의 중',x.status==='available'?'green':x.status==='complete'?'gray':'yellow')}</td><td>${escapeHtml(x.transaction_type)}</td><td>${escapeHtml(x.property_type)}</td><td class="listing-title-cell"><strong>${escapeHtml(x.title)}</strong>${x.is_public?'':' '+badge('비공개','red')}</td><td>${escapeHtml(listingAreaText(x))}</td><td>${fmtMoney(x.price)}</td><td>${escapeHtml(x.contact_phone||'-')}</td><td>${x.loan_available===true?badge('O','green'):x.loan_available===false?badge('X','red'):badge('미확인','gray')}${x.loan_available===true&&x.official_price?`<br><span class="muted">기준 ${fmtMoney(x.official_price)}</span>`:''}</td><td>${x.area_m2?x.area_m2+'㎡':'-'}</td><td>${moveInText(x)}</td><td>${escapeHtml(x.owner?.full_name||'-')}</td><td>${contractStage(x)}</td><td>${fmtDate(x.last_follow_up_at||x.last_confirmed_at)}</td><td>${dueBadge(x.next_follow_up_at)}</td>${mine?`<td><div class="row-actions"><button class="success" onclick="openFollowUpModal('listing','${x.id}')">FU</button><button class="ghost" onclick="openHistoryModal('listing','${x.id}')">히스토리</button><button class="ghost" onclick="openContractModal('listing','${x.id}')">계약일정</button><button class="ghost" onclick="openListingModal('${x.id}')">수정</button>${adminMode?`<button class="primary" onclick="openSingleListingTransfer('${x.id}')">개별 이관</button>`:''}<button class="danger" onclick="deleteListing('${x.id}')">삭제</button></div></td>`:''}</tr>`).join('')}</tbody></table></div>`:'<div class="empty">조건에 맞는 매물이 없습니다.</div>';
}
function openListingModal(id){
  const x=state.listings.find(v=>v.id===id)||{};$('#modalTitle').textContent=id?'매물 수정':'매물 등록';
  $('#modalBody').innerHTML=`<div class="form-grid"><label>매물명<input name="title" value="${escapeHtml(x.title||'')}" required></label><label>매도/임대인 연락처<input name="contact_phone" value="${escapeHtml(x.contact_phone||'')}" placeholder="010-0000-0000" required></label><label>거래 유형<select name="transaction_type"><option>매매</option><option>전세</option><option>월세</option></select></label><label>매물 유형<select name="property_type"><option>아파트</option><option>오피스텔</option><option>빌라</option><option>상가</option><option>사무실</option><option>토지</option></select></label><label>상태<select name="status"><option value="available">거래 가능</option><option value="hold">협의 중</option><option value="complete">거래 완료</option></select></label><label>지역<input name="district" value="${escapeHtml(x.district||'')}"></label><label class="span-2">주소<input name="address" value="${escapeHtml(x.address||'')}"></label><label>금액(만원)<input name="price" type="number" value="${x.price||''}"></label><label>월세(만원)<input name="monthly_rent" type="number" value="${x.monthly_rent||''}"></label><label>관리비(만원)<input name="management_fee" type="number" step="0.1" value="${x.management_fee??''}"></label><label>전용면적(㎡)<input name="area_m2" type="number" step="0.01" value="${x.area_m2||''}"></label><label class="span-2">옵션<input name="options" value="${escapeHtml(x.options||'')}" placeholder="예: 에어컨, 냉장고, 세탁기, 붙박이장"></label><label>반려동물<select name="pet_allowed"><option>미확인</option><option>가능</option><option>불가</option><option>협의</option></select></label><label>대출 가능 여부<select id="listingLoanAvailable" name="loan_available"><option value="">미확인</option><option value="true">O</option><option value="false">X</option></select></label><label id="listingOfficialPriceWrap">공시지가/기준시가(만원)<input name="official_price" type="number" value="${x.official_price||''}"></label><label>입주 가능일<input id="moveInDateInput" name="move_in_date" type="date" value="${x.move_in_date||''}"></label><label class="check-label"><input id="moveInNegotiable" name="move_in_negotiable" type="checkbox" ${x.move_in_negotiable?'checked':''}> 입주일 협의 가능</label><label>예정 FU<input name="next_follow_up_at" type="date" value="${x.next_follow_up_at?x.next_follow_up_at.slice(0,10):''}"></label><label>공개 여부<select name="is_public"><option value="true">공개</option><option value="false">비공개</option></select></label><label>최종 확인일<input name="last_confirmed_at" type="date" value="${x.last_confirmed_at?x.last_confirmed_at.slice(0,10):''}"></label><label class="span-2">상세 설명<textarea name="description" rows="5">${escapeHtml(x.description||'')}</textarea></label></div>`;
  ['transaction_type','property_type','status'].forEach(n=>$('#modalBody').querySelector(`[name=${n}]`).value=x[n]||({transaction_type:'매매',property_type:'아파트',status:'available'}[n]));$('#modalBody').querySelector('[name=is_public]').value=String(x.is_public!==false);$('#modalBody').querySelector('[name=pet_allowed]').value=x.pet_allowed||'미확인';const listingLoan=$('#listingLoanAvailable');listingLoan.value=x.loan_available===true?'true':x.loan_available===false?'false':'';const toggleListingOfficial=()=>{$('#listingOfficialPriceWrap').style.display=listingLoan.value==='true'?'':'none'};listingLoan.onchange=toggleListingOfficial;toggleListingOfficial();
  $('#modalSubmit').onclick=async(e)=>{e.preventDefault();const fd=new FormData($('#modalForm'));const p=Object.fromEntries(fd.entries());p.owner_id=id?(x.owner_id||state.profile.id):state.profile.id;p.is_public=p.is_public==='true';['price','monthly_rent','management_fee','area_m2'].forEach(k=>p[k]=p[k]?Number(p[k]):null);p.loan_available=p.loan_available===''?null:p.loan_available==='true';p.official_price=p.loan_available===true&&p.official_price?Number(p.official_price):null;p.move_in_negotiable=fd.get('move_in_negotiable')==='on';p.move_in_date=p.move_in_negotiable?null:(p.move_in_date||null);p.next_follow_up_at=p.next_follow_up_at||null;p.last_confirmed_at=p.last_confirmed_at||new Date().toISOString().slice(0,10);const q=id?state.client.from('listings').update(p).eq('id',id):state.client.from('listings').insert(p);const {error}=await q;if(error)return toast(error.message);$('#modal').close();toast('저장했습니다. 공동매물망에 반영됩니다.');state.view==='adminListings'?renderAdminListings():renderMyListings()};$('#modal').showModal();
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
  const detailFields=demandSide?`
    <div class="contract-detail-grid">
      <label>계약 매물명<input name="contracted_property_name" value="${escapeHtml(defaultProperty)}" placeholder="예: 철산자이 101동 1203호"></label>
      <label>거래유형<select name="contracted_transaction_type"><option value="">선택</option><option>매매</option><option>전세</option><option>월세</option></select></label>
      <label>거래금액(만원)<input name="contracted_amount" type="number" value="${defaultAmount}"></label>
      <label>매도/임대측 연락처<input name="counterparty_phone" value="${escapeHtml(item.counterparty_phone||'')}" placeholder="010-0000-0000"></label>
    </div>`:`
    <div class="contract-detail-grid">
      ${entityType==='listing'?`<label>계약 매물명<input name="contracted_property_name" value="${escapeHtml(defaultProperty)}"></label><label>거래유형<select name="contracted_transaction_type"><option value="">선택</option><option>매매</option><option>전세</option><option>월세</option></select></label>`:''}
      <label>거래금액(만원)<input name="contracted_amount" type="number" value="${defaultAmount}"></label>
      <label>거래 고객명<input name="counterparty_name" value="${escapeHtml(item.counterparty_name||'')}" placeholder="매수인 또는 임차인 이름"></label>
      <label>매수/임차측 연락처<input name="counterparty_phone" value="${escapeHtml(item.counterparty_phone||'')}" placeholder="010-0000-0000"></label>
    </div>`;
  $('#modalBody').innerHTML=`<div class="contract-editor"><p class="muted">계약 상대방 정보와 일정을 함께 기록하세요. 저장된 내용은 히스토리에 자동으로 남습니다.</p><section class="contract-detail-box"><h4>계약 정보</h4>${detailFields}</section>${steps.map(([key,label,amountKey,amountLabel],i)=>{const isInterim=key==='interim_payment_date',na=isInterim&&item.interim_payment_not_applicable;return `<div class="contract-edit-row ${na?'not-applicable':''}" data-contract-row="${key}"><div class="step-no">${i+1}</div><label class="check-label"><input type="checkbox" data-stage-check="${key}" ${item[key]?'checked':''} ${na?'disabled':''}> ${label}</label><input type="date" name="${key}" value="${item[key]||''}" ${item[key]&&!na?'':'disabled'}><label class="stage-amount-label">${amountLabel}(만원)<input type="number" min="0" step="1" name="${amountKey}" value="${item[amountKey]??''}" ${item[key]&&!na?'':'disabled'} placeholder="금액"></label>${isInterim?`<label class="na-label"><input type="checkbox" id="interimNotApplicable" ${na?'checked':''}> 해당없음</label>`:''}</div>`}).join('')}</div>`;
  const typeSelect=$('#modalBody [name=contracted_transaction_type]');if(typeSelect)typeSelect.value=defaultType||'';
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
    const detailKeys=['contracted_property_name','contracted_transaction_type','contracted_amount','counterparty_name','counterparty_phone'];
    const detailChanged=detailKeys.some(k=>String(item[k]??'')!==String(payload[k]??''));
    if(detailChanged&&detail)histories.push({...target,created_by:state.profile.id,follow_up_date:today(),contact_method:'계약정보',content:`계약 정보 등록/변경함.\n${detail}`,next_follow_up_at:null});
    if(histories.length){const {error:hErr}=await state.client.from('interaction_history').insert(histories);if(hErr)return toast(`계약 일정은 저장됐지만 히스토리 기록 실패: ${hErr.message}`)}
    $('#modal').close();toast('계약 정보·일정과 히스토리를 저장했습니다.');entityType==='customer'?renderCustomers():(state.view==='adminListings'?renderAdminListings():renderMyListings());
  };
  $('#modal').showModal();
}

async function deleteListing(id){if(!confirm('매물을 삭제할까요?'))return;const {error}=await state.client.from('listings').delete().eq('id',id);if(error)return toast(error.message);toast('삭제했습니다.');state.view==='adminListings'?renderAdminListings():renderMyListings()}

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
