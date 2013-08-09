/**
 * author: mdemo
 * Date: 13-8-8
 * Time: 下午5:31
 * Desc:
 */
module.exports=function(args){
    var config ={},
        config_3g={
            bandwidth_down:160000,
            bandwidth_up:160000,
            latency:400,
            port:199105
        },
        config_2g={
            bandwidth_down:80000,
            bandwidth_up:80000,
            latency:800,
            port:199105
        };
    if(args._.length==4){
        config={
            bandwidth_down:args._[0]*1000,
            bandwidth_up:args._[1]*1000,
            latency:args._[2],
            port:args._[3]
        }
    }
    else if(args._.length==1){
        if(args._[0]=="3g"){
            config = config_3g;
        }
        else if(args._[0]=="2g"){
            config = config_2g;
        }
        else{
            console.log("please input right arguments");
            return false;
        }

    }
    else{
        console.log("please input right arguments");
        return false;
    }
    return config;
}
