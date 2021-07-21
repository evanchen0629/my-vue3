var VueReactivity = (function (exports) {
  'use strict';

  function isObject(val) {
      return typeof val == 'object' && val !== null;
  }
  // ...
  function hasChanged(oldValue, newValue) {
      return oldValue !== newValue;
  }
  var isArray = Array.isArray;
  var extend = Object.assign;
  var isIntegerKey = function (key) {
      return parseInt(key) + '' === key;
  };
  var hasOwn = function (target, key) {
      return Object.prototype.hasOwnProperty.call(target, key);
  };

  function effect(fn, options) {
      if (options === void 0) { options = {}; }
      var effect = createReactiveEffect(fn, options);
      if (!options.lazy) {
          effect();
      }
      return effect; // 返回响应式的effect
  }
  var activeEffect;
  var effectStack = [];
  var id = 0;
  // 当用户取值的时候需要将activeEffect 和 属性做关联
  // 当用户更改的时候 要通过属性找到effect重新执行
  function createReactiveEffect(fn, options) {
      var effect = function reactiveEffect() {
          // 这就是effect中的effect
          try {
              effectStack.push(effect);
              activeEffect = effect;
              return fn(); // 会取值
          }
          finally {
              effectStack.pop();
              activeEffect = effectStack[effectStack.length - 1];
          }
      };
      effect.id = id++; // 构建的是一个id
      effect.__isEffect = true;
      effect.options = options;
      effect.deps = []; // effect用来收集依赖了那些属性
      return effect;
  }
  // 一个属性对应多个effect， 一个effect还可以对应多个属性
  // target key = [effect,effect]
  // Map{
  //     {name:'ccz',age:12}:{
  //         age:new Set(effect),
  //         name:new Set(effect),
  //     },
  // }
  var targetMap = new WeakMap();
  function track(target, type, key) {
      if (activeEffect == undefined) {
          return; // 用户只是取了值，而且这个值不是在effect中使用的 ，什么都不用收集
      }
      var depsMap = targetMap.get(target);
      if (!depsMap) {
          targetMap.set(target, (depsMap = new Map()));
      }
      var dep = depsMap.get(key);
      if (!dep) {
          depsMap.set(key, (dep = new Set()));
      }
      if (!dep.has(activeEffect)) {
          dep.add(activeEffect);
      }
  }
  function trigger(target, type, key, newValue, oldValue) {
      // 去映射表里找到属性对应的 effect， 让她重新执行
      var depsMap = targetMap.get(target);
      if (!depsMap)
          return; // 只是改了属性，这个属性没有在effect中使用
      var effectsSet = new Set();
      var add = function (effectsAdd) {
          // 如果同时有多个 依赖的effect是同一个 还用set做了一个过滤
          if (effectsAdd) {
              effectsAdd.forEach(function (effect) { return effectsSet.add(effect); });
          }
      };
      // 1.如果更改的数组长度 小于依赖收集的长度 要触发重新渲染
      // 2.如果调用了push方法 或者其他新增数组的方法（必须能改变长度的方法）， 也要触发更新
      if (key === 'length' && isArray(target)) {
          // 如果是数组，你改了length
          depsMap.forEach(function (dep, key) {
              if (key > newValue || key === 'length') {
                  add(dep); // 更改的数组长度 比收集到的属性的值小
              }
          });
      }
      else {
          add(depsMap.get(key));
          switch (type) {
              case 'add':
                  if (isArray(target) && isIntegerKey(key)) {
                      add(depsMap.get('length')); // 增加属性 需要触发length的依赖收集
                  }
          }
      }
      effectsSet.forEach(function (effect) { return effect(); });
  }

  function createGetter(isReadonly, shallow) {
      if (isReadonly === void 0) { isReadonly = false; }
      if (shallow === void 0) { shallow = false; }
      /**
       * target 是原来的对象
       * key 去取什么属性
       * recevier 代理对象
       */
      return function get(target, key, receiver) {
          // return target[key];
          // Reflect 就是要后续慢慢替换掉Object对象，一般使用proxy 会配合Reflect
          var res = Reflect.get(target, key, receiver); // Reflect.ownKey Reflect.defineProperty
          if (!isReadonly) {
              track(target, 'get', key);
          }
          if (shallow) {
              return res;
          }
          if (isObject(res)) {
              // 懒递归 当我们取值的时候才去做递归代理，如果不取默认值代理一层
              return isReadonly ? readonly(res) : reactive(res);
          }
          return res;
      };
      // vue3 针对的是对象来进行劫持， 不用改写原来的对象,如果是嵌套，当取值的时候才会代理
      // vue2 针对的是属性劫持，改写了原来对象，一上来就递归的
      // vue3 可以对不存在的属性进行获取，也会走get方法, proxy支持数组
  }
  function createSetter(shallow) {
      // 针对数组而言 如果调用push方法，就会产生2次处罚 1.给数组新增了一项，同时也更改了长度 2.因为更改了长度再次触发set （第二次的触发是无意义的）
      return function set(target, key, value, receiver) {
          var oldValue = target[key]; // 获取老值
          // target[key] = value; // 如果设置失败 没有返回值
          // 有一个属性不能被修改 target[key] = value;  不会报错，但是通过Reflect.set 会返回false
          // 设置属性，可能以前有，还有可能以前没有 （新增和修改）
          // 如何判断数组是新增还是修改
          var hadKey = isArray(target) && isIntegerKey(key)
              ? Number(key) < target.length
              : hasOwn(target, key);
          var res = Reflect.set(target, key, value, receiver);
          if (!hadKey) {
              trigger(target, 'add', key, value);
          }
          else if (hasChanged(oldValue, value)) {
              trigger(target, 'set', key, value);
          }
          return res;
      };
  }
  var get = createGetter(); // 不是仅读的也不是浅的
  var shallowGet = createGetter(false, true);
  var readonlyGet = createGetter(true);
  var shallowReadonlyGet = createGetter(true, true);
  var set = createSetter();
  var shallowSet = createSetter(); // readonly没有set
  // new Proxy(target,{})
  var mutableHandler = {
      // reactive中的get和set
      get: get,
      set: set,
  };
  var shallowReactiveHandlers = {
      get: shallowGet,
      set: shallowSet,
  };
  var readonlySet = {
      set: function (target, key) {
          console.warn("cannot set " + JSON.stringify(target) + " on  key " + key + " falied");
      },
  };
  var readonlyHandlers = extend({
      get: readonlyGet,
  }, readonlySet);
  var shallowReadonlyHandlers = extend({
      get: shallowReadonlyGet,
  }, readonlySet);
  // 取值 设置值

  // 是否是浅的，默认是深度
  // 是否是仅读的 默认不是仅读的
  function reactive(target) {
      return createReactiveObject(target, false, mutableHandler);
  }
  function shallowReactive(target) {
      return createReactiveObject(target, false, shallowReactiveHandlers);
  }
  function readonly(target) {
      return createReactiveObject(target, true, readonlyHandlers);
  }
  function shallowReadonly(target) {
      return createReactiveObject(target, true, shallowReadonlyHandlers);
  }
  /**
   *
   * @param target 创建代理的目标
   * @param isReadonly 当前是不是仅读的
   * @param baseHandler 针对不同的方式创建不同的代理对象
   */
  // weakMap(key只能是对象) map(key可以是其他类型)
  var reactiveMap = new WeakMap(); // 目的是添加缓存
  var readonlyMap = new WeakMap();
  function createReactiveObject(target, isReadonly, baseHandler) {
      if (!isObject(target)) {
          return target;
      }
      var proxyMap = isReadonly ? readonlyMap : reactiveMap;
      var existProxy = proxyMap.get(target);
      if (existProxy) {
          return existProxy; // 如果已经代理过了，那就直接把上次的代理返回就可以的
      }
      // 如果是对象 就做一个代理 new proxy
      var proxy = new Proxy(target, baseHandler);
      proxyMap.set(target, proxy);
      return proxy;
  }
  // 数组，对象是如何劫持 effect 的实现 ref的实现。。。

  exports.effect = effect;
  exports.reactive = reactive;
  exports.readonly = readonly;
  exports.shallowReactive = shallowReactive;
  exports.shallowReadonly = shallowReadonly;

  Object.defineProperty(exports, '__esModule', { value: true });

  return exports;

}({}));
//# sourceMappingURL=reactivity.global.js.map
