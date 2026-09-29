document.querySelector('#shadow-source').attachShadow({mode:'open'}).textContent='SECRET_SHADOW';
document.querySelector('#append').onclick=()=>{const p=document.createElement('p');p.textContent='追加：目前仍无法确认这一结论。';document.querySelector('#article').append(p);};
document.querySelector('#replace').onclick=()=>{const old=document.querySelector('#restriction');const p=document.createElement('p');p.id='restriction';p.textContent='取消订阅后没有额外限制。';old.replaceWith(p);};
document.querySelector('#route').onclick=()=>{history.pushState({},'',`?article=${Date.now()}`);document.querySelector('h1').textContent='另一篇文章';};
