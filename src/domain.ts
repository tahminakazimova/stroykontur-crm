export type Status = 'new'|'working'|'review'|'accepted'|'revision';
export type Profile = {id:string;name:string;role:'manager'|'executor';email?:string};
export type Site = {id:string;name:string;address:string;created_at:string;photo_paths?:string[]};
export type Task = {id:string;title:string;description:string;object_id:string;assignee_id:string;author_id:string;status:Status;created_at:string};
export type History = {id:string;task_id:string;actor_id:string;actor_name:string;from_status:Status|null;to_status:Status;comment:string|null;created_at:string};
export const labels:Record<Status,string>={new:'Новая',working:'В работе',review:'На проверке',accepted:'Принята',revision:'На доработке'};
export function actions(task:Task,user:Profile):Status[]{if(user.role==='manager')return task.status==='review'?['accepted','revision']:[];if(task.assignee_id!==user.id)return [];return task.status==='new'||task.status==='revision'?['working']:task.status==='working'?['review']:[];}
export const actionLabels:Partial<Record<Status,string>>={working:'Взять в работу',review:'Отправить на проверку',accepted:'Принять работу',revision:'Вернуть на доработку'};
