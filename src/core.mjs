function mapEvent(event) {
  const rules = {
    "customer.updated": {source:"crm",target:"erp",fields:["customer_id","name","email"]},
    "order.created": {source:"commerce",target:"erp",fields:["order_id","customer_id","sku","quantity"]},
    "inventory.updated": {source:"erp",target:"commerce",fields:["sku","quantity"]}
  };
  if(!event||typeof event!=="object"||Array.isArray(event))throw Error("Expected an event object");
  const {id,type,source,payload}=event;
  if(typeof id!=="string"||!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/.test(id))throw Error("Invalid event id");
  if(typeof type!=="string"||!Object.hasOwn(rules,type)||rules[type].source!==source)throw Error("Unsupported event route");
  if(!payload||typeof payload!=="object"||Array.isArray(payload))throw Error("Invalid payload");
  const rule=rules[type],data={};
  for(const field of rule.fields){
    const value=payload[field];
    if(field==="quantity"){if(!Number.isSafeInteger(value)||value<0||value>1000000000||(type==="order.created"&&value===0))throw Error("Invalid quantity");}
    else if(typeof value!=="string"||!value.trim()||value.length>200)throw Error("Invalid "+field);
    data[field]=typeof value==="string"?value.trim():value;
  }
  if(type==="customer.updated"&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email))throw Error("Invalid email");
  return {id,type,source,target:rule.target,data};
}

function failureDecision(attempt,permanent,now,maxAttempts=4){
  if(permanent||attempt>=maxAttempts)return {status:"dead",nextAt:now};
  return {status:"retry",nextAt:now+Math.min(60000,1000*2**(attempt-1))};
}

function simulateDelivery(event,attempt,mode){
  if(mode==="permanent")return {ok:false,permanent:true,message:"Target rejected record (422)"};
  if(mode==="transient"&&attempt<=2)return {ok:false,permanent:false,message:"Target temporarily unavailable (503)"};
  return {ok:true,message:"Target accepted record (200)"};
}

export {mapEvent,failureDecision,simulateDelivery};
