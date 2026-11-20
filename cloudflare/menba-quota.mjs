const dailyBudget = 10000;
const utcDay = () => new Date().toISOString().slice(0,10);

export class MenbaQuota {
  constructor(state) {
    this.storage = state.storage;
  }

  async fetch(request) {
    const {account, owner, operation, limit, amount, id, used, day} = await request.json();
    const today = utcDay();
    return this.storage.transactionSync(()=>{
      const {kv} = this.storage;
      const usage = kv.get('usage');
      const current = usage?.day === today ? usage : {day:today,total:0,members:{},holds:{}};
      const key = `limit:${account}`;
      const allotted = kv.get(key) ?? (owner ? dailyBudget : 0);
      const charged = current.members[account] ?? 0;
      if (operation === 'status') {
        return Response.json({day:today,budget:dailyBudget,total:current.total,limit:allotted,used:charged});
      }
      if (operation === 'limit') {
        if (!Number.isInteger(limit) || limit < 0 || limit > dailyBudget) return new Response(null,{status:400});
        kv.put(key,limit);
        return Response.json({day:today,budget:dailyBudget,total:current.total,limit,used:charged});
      }
      if (operation === 'reserve') {
        if (!Number.isInteger(amount) || amount < 1 || amount > dailyBudget || typeof id !== 'string') {
          return new Response(null,{status:400});
        }
        if (charged + amount > allotted || current.total + amount > dailyBudget) return new Response(null,{status:429});
        current.total += amount;
        current.members[account] = charged + amount;
        current.holds[id] = {account,amount};
        kv.put('usage',current);
        return Response.json({day:today});
      }
      if (operation === 'settle') {
        const hold = current.holds[id];
        if (day === today && hold?.account === account) {
          if (Number.isInteger(used) && used > 0) {
            current.total += used - hold.amount;
            current.members[account] += used - hold.amount;
          }
          delete current.holds[id];
          kv.put('usage',current);
        }
        return new Response(null,{status:204});
      }
      return new Response(null,{status:404});
    });
  }
}

export function reservationCost(input, answerTokens = 360, answerCharacters = 650) {
  const bytes = new TextEncoder().encode(JSON.stringify(input)).length;
  // Upper estimate includes both prompts, the verifier's copy of the answer, templates and output caps.
  return Math.ceil((bytes*2 + 6400 + answerCharacters*4) * .009091 + (answerTokens+120) * .027273);
}

export function reportedCost(usage) {
  const {prompt_tokens:input,completion_tokens:output} = usage ?? {};
  if (!Number.isSafeInteger(input) || input < 0 || !Number.isSafeInteger(output) || output < 0 || input+output === 0) return null;
  return (input * 9091 + output * 27273) / 1000000;
}
